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

    // Escuta as requisições de API no background para garantir captura total dos dados de rede
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('tarefa') || url.includes('todo') || url.includes('api') || url.includes('list')) {
        try {
          const json = await response.json();
          const items = json.data || json.items || (Array.isArray(json) ? json : []);
          if (Array.isArray(items)) {
            items.forEach((item, index) => {
              if (item.title || item.nome || item.descricao) {
                tarefasInterceptadas.push({
                  id: String(item.id || `item_${Date.now()}_${index}`),
                  plataforma: item.discipline_name || item.componente || item.categoria || 'Tarefa SP',
                  titulo: item.title || item.nome || item.descricao,
                  descricao: item.description || item.aprendizagem || '',
                  prazo: item.due_date || item.data_limite || (item.expired ? 'Expirado' : 'Pendente'),
                  linkAcao: item.link || item.url || 'https://salvaestudante.com/tarefas'
                });
              }
            });
          }
        } catch (e) {}
      }
    });

    console.log('2. Acessando salvaestudante.com para Login...');
    await page.goto('https://salvaestudante.com', { waitUntil: 'networkidle2', timeout: 30000 });

    // Se houver tela de login, faz a autenticação com as credenciais fornecidas
    const temInputs = await page.$('input');
    if (temInputs) {
      console.log('3. Realizando login...');
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

      // Clica em Acessar
      await page.evaluate(() => {
        const botoes = Array.from(document.querySelectorAll('button'));
        const btn = botoes.find(b => b.innerText && b.innerText.trim().toLowerCase().includes('acessar'));
        if (btn) btn.click();
      });

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('4. Navegando para /tarefas...');
    await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    console.log('5. Extraindo todos os elementos visuais do DOM...');
    const tarefasDOM = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="card"], div[style*="border"], div[style*="background"]'));
      const lista = [];

      cards.forEach((card, idx) => {
        const textoCard = card.innerText || '';
        // Só considera blocos que pareçam uma tarefa (possuem palavra "Tarefa" ou botão "Fazer tarefa")
        if (textoCard.includes('Tarefa') || textoCard.includes('Fazer') || textoCard.includes('Vence') || textoCard.includes('Expirado')) {
          const tituloEl = card.querySelector('h3, h4, strong, [class*="titulo"]') || card;
          const prazoEl = card.querySelector('[class*="status"], [class*="badge"], [class*="vence"], [class*="expirado"]');
          const botaoEl = card.querySelector('button, a');

          const tituloText = tituloEl ? tituloEl.innerText.split('\n')[0] : `Tarefa ${idx + 1}`;
          
          if (tituloText && tituloText.trim().length > 3) {
            lista.push({
              id: `dom_${idx}_${Date.now()}`,
              plataforma: 'Tarefa SP',
              titulo: tituloText.trim(),
              descricao: card.querySelector('p')?.innerText || '',
              prazo: prazoEl ? prazoEl.innerText.trim() : (textoCard.includes('Expirado') ? 'Expirado' : 'Vence hoje'),
              linkAcao: botaoEl ? (botaoEl.href || 'fazer_tarefa') : 'fazer_tarefa'
            });
          }
        }
      });

      return lista;
    });

    // Dados do aluno capturados do cabeçalho
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
    const todasTarefas = [...tarefasDOM, ...tarefasInterceptadas];
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
          descricao: "Todas as suas tarefas foram concluídas.",
          prazo: "Tudo em dia",
          linkAcao: "#"
        }
      ]
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('Erro na extração:', error);
    return res.status(500).json({ erro: `Falha na consulta: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
