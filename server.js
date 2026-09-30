import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/consultar', async (req, res) => {
  const { ra, digito, uf, senha } = req.body;

  if (!ra || !senha) {
    return res.status(400).json({ erro: 'RA e senha são obrigatórios.' });
  }

  let browser = null;
  const tarefasInterceptadas = [];

  try {
    console.log('1. Iniciando navegador...');
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Escuta e captura a API exata descoberta na inspeção de rede
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/activities/todo') || url.includes('/api/activities') || url.includes('type=NormalTask')) {
        try {
          const json = await response.json();
          console.log('-> API de Tarefas Interceptada com Sucesso!');

          const lista = Array.isArray(json) ? json : (json.data || json.items || json.activities || []);

          if (Array.isArray(lista)) {
            lista.forEach((item, index) => {
              tarefasInterceptadas.push({
                id: String(item.id || `task_${index}`),
                plataforma: item.discipline_name || item.component_name || item.subject || 'Tarefa SP',
                titulo: item.title || item.name || item.description || 'Tarefa sem título',
                descricao: item.learning_goals || item.description || '',
                prazo: item.due_date || (item.expired ? 'Expirado' : 'Vence hoje'),
                linkAcao: item.url || item.link || 'https://salvaestudante.com/tarefas'
              });
            });
          }
        } catch (e) {
          console.error('Erro ao ler JSON da resposta:', e.message);
        }
      }
    });

    console.log('2. Acessando salvaestudante.com para Login...');
    await page.goto('https://salvaestudante.com', { waitUntil: 'networkidle2', timeout: 30000 });

    const temInputs = await page.$('input');
    if (temInputs) {
      console.log('3. Preenchendo credenciais...');
      await page.evaluate(({ raVal, digitoVal, ufVal, senhaVal }) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const inputRA = inputs.find(i => i.placeholder && i.placeholder.includes('0000')) || inputs[0];
        const inputDigito = inputs.find(i => i.placeholder === '0') || inputs[1];
        const inputSenha = inputs.find(i => i.type === 'password' || (i.placeholder && i.placeholder.toLowerCase().includes('senha'))) || inputs[inputs.length - 1];

        if (inputRA) {
          inputRA.value = raVal;
          inputRA.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (inputDigito) {
          inputDigito.value = digitoVal || '0';
          inputDigito.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (inputSenha) {
          inputSenha.value = senhaVal;
          inputSenha.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const selectUF = document.querySelector('select');
        if (selectUF && ufVal) {
          selectUF.value = ufVal.toUpperCase();
          selectUF.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { raVal: ra, digitoVal: digito, ufVal: uf || 'SP', senhaVal: senha });

      console.log('4. Clicando em Acessar...');
      await page.evaluate(() => {
        const botoes = Array.from(document.querySelectorAll('button'));
        const btn = botoes.find(b => b.innerText && b.innerText.trim().toLowerCase().includes('acessar'));
        if (btn) btn.click();
      });

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('5. Indo diretamente para /tarefas para disparar a API...');
    await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Captura dados do perfil do aluno no cabeçalho
    const perfilAluno = await page.evaluate(() => {
      const body = document.body.innerText;
      const matchNome = body.match(/Olá,\s*([^\n]+)/i);
      const matchTurma = body.match(/(\d+ª\s*SERIE[^\n]+)/i);
      const matchPendencias = body.match(/(\d+)\s*\n*\s*Pendências/i);
      const matchFaltas = body.match(/(\d+)\s*\n*\s*Faltas/i);

      return {
        nome: matchNome ? matchNome[1].trim() : 'Estudante',
        turma: matchTurma ? matchTurma[1].trim() : 'Turma Ativa',
        totalPendencias: matchPendencias ? matchPendencias[1] : '0',
        totalFaltas: matchFaltas ? `${matchFaltas[1]} faltas` : '0 faltas'
      };
    });

    await browser.close();

    // Filtra tarefas duplicadas pelo título
    const tarefasUnicas = Array.from(new Set(tarefasInterceptadas.map(t => t.titulo)))
      .map(titulo => tarefasInterceptadas.find(t => t.titulo === titulo));

    return res.json({
      sucesso: true,
      aluno: {
        nome: perfilAluno.nome,
        turma: perfilAluno.turma
      },
      resumo: {
        pendencias: tarefasUnicas.length > 0 ? tarefasUnicas.length.toString() : perfilAluno.totalPendencias,
        faltas: perfilAluno.totalFaltas
      },
      tarefas: tarefasUnicas.length > 0 ? tarefasUnicas : [
        {
          id: "0",
          plataforma: "Tarefa SP",
          titulo: "Nenhuma atividade pendente encontrada!",
          descricao: "Todas as tarefas foram concluídas.",
          prazo: "Tudo em dia",
          linkAcao: "#"
        }
      ]
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('Erro:', error.message);
    return res.status(500).json({ erro: `Falha ao consultar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
