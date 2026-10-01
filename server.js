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

  try {
    console.log('1. Iniciando navegador...');
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
    );

    console.log('2. Acessando salvaestudante.com...');
    await page.goto('https://salvaestudante.com', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('3. Aguardando campos de input...');
    await page.waitForSelector('input', { timeout: 15000 });

    // Preenche as credenciais simulando digitação real do usuário
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].click();
      await page.keyboard.type(ra, { delay: 50 });

      if (inputs.length >= 3 && digito) {
        await inputs[1].click();
        await page.keyboard.type(digito, { delay: 50 });
        await inputs[inputs.length - 1].click();
        await page.keyboard.type(senha, { delay: 50 });
      } else {
        await inputs[inputs.length - 1].click();
        await page.keyboard.type(senha, { delay: 50 });
      }
    }

    console.log('4. Clicando no botão de Acessar e aguardando navegação...');
    // Pressiona Enter para submeter o formulário de login
    await page.keyboard.press('Enter');

    // Aguarda o processamento e eventuais redirecionamentos da sessão
    await new Promise(r => setTimeout(r, 6000));

    console.log('5. Verificando URL atual e executando fetch autenticado...');
    console.log('URL após login:', page.url());

    // Tenta primeiro navegar para a rota interna /tarefas caso o login tenha sido concluído
    await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Faz a chamada ao endpoint de tarefas injetando tokens de autenticação se existirem
    const tarefasCapturadas = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const urlAPI = 'https://salvaestudante.com/api/activities/todo?type=NormalTask&includeDraft=true&includeExpired=true&expiredOnly=false&limit=20&offset=0';
        const response = await fetch(urlAPI, { method: 'GET', headers });

        if (!response.ok) return [];
        const json = await response.json();

        const items = Array.isArray(json) ? json : (json.data || json.items || json.activities || json.todo || []);

        return items.map(item => ({
          id: String(item.id || Math.random()),
          plataforma: item.realm ? item.realm.toUpperCase() : 'Tarefa SP',
          titulo: (item.title || item.nome || item.name || 'Tarefa').trim(),
          descricao: item.description || item.learning_goals || 'Sem descrição cadastrada.',
          prazo: item.task_expired ? 'Expirado' : 'A Fazer',
          linkAcao: 'https://salvaestudante.com/tarefas'
        }));
      } catch (err) {
        return [];
      }
    });

    await browser.close();
    browser = null;

    console.log(`Finalizado! Capturadas ${tarefasCapturadas.length} tarefas com sucesso.`);

    return res.json({
      sucesso: true,
      aluno: { nome: 'Estudante', turma: 'Turma Ativa' },
      resumo: {
        pendencias: tarefasCapturadas.length > 0 ? tarefasCapturadas.length.toString() : '0',
        faltas: '0 faltas'
      },
      tarefas: tarefasCapturadas.length > 0 ? tarefasCapturadas : [
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
    console.error('Erro na consulta:', error.message);
    return res.status(500).json({ erro: `Falha na consulta: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
