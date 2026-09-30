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

    // Escuta requisições de API de tarefas no background
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/activities') || url.includes('/todo') || url.includes('tasks') || url.includes('tarefa')) {
        try {
          const json = await response.json();
          const items = Array.isArray(json) ? json : (json.data || json.items || json.activities || []);

          if (Array.isArray(items)) {
            items.forEach((item, index) => {
              // Pega estritamente o título/nome da atividade
              const nomeTarefa = item.title || item.nome || item.name;
              if (nomeTarefa && !nomeTarefa.toLowerCase().includes('nenhuma atividade')) {
                tarefasInterceptadas.push({
                  id: String(item.id || `task_${index}`),
                  plataforma: item.discipline_name || item.component_name || item.subject || 'Tarefa SP',
                  titulo: nomeTarefa.trim(),
                  descricao: item.learning_goals || item.description || item.aprendizagem || '',
                  prazo: item.due_date || (item.expired ? 'Expirado' : 'A Fazer'),
                  linkAcao: item.url || item.link || 'https://salvaestudante.com/tarefas'
                });
              }
            });
          }
        } catch (e) {}
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

    console.log('5. Navegando para /tarefas e extraindo dados reais...');
    await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 4000));

    // Raspagem visual via DOM caso a API falhe
    const tarefasDOM = await page.evaluate(() => {
      const resultados = [];
      const elementos = Array.from(document.querySelectorAll('h3, h4, strong, [class*="titulo"], [class*="title"]'));

      elementos.forEach((el, idx) => {
        const texto = el.innerText ? el.innerText.trim() : '';
        // Procura por títulos que iniciem com "Tarefa" (ex: "Tarefa 4: Evolução da Vida e Filogenia")
        if (texto.toLowerCase().startsWith('tarefa') && texto.length > 5 && !resultados.some(r => r.titulo === texto)) {
          // Pega o container pai do card para extrair a descrição
          const container = el.closest('div[class*="card"], div[style*="border"], article, section') || el.parentElement;
          const textoContainer = container ? container.innerText : '';
          
          let descricao = '';
          if (textoContainer.includes('Aprendizagem Essencial:')) {
            descricao = textoContainer.split('Aprendizagem Essencial:')[1]?.split('\n')[0]?.trim() || '';
          }

          resultados.push({
            id: `dom_${idx}`,
            plataforma: 'Tarefa SP',
            titulo: texto,
            descricao: descricao,
            prazo: textoContainer.includes('Expirado') ? 'Expirado' : 'A Fazer',
            linkAcao: 'https://salvaestudante.com/tarefas'
          });
        }
      });

      return resultados;
    });

    // Captura os dados do perfil do aluno
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

    // Consolida e remove duplicatas
    const todasTarefas = [...tarefasInterceptadas, ...tarefasDOM];
    const tarefasUnicas = Array.from(new Set(todasTarefas.map(t => t.titulo)))
      .map(titulo => todasTarefas.find(t => t.titulo === titulo));

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
