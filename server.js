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
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // Define os mesmos headers e User-Agent capturados no seu F12
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
    );

    // Intercepta a chamada exata capturada no seu F12 (/api/activities/todo)
    page.on('response', async (response) => {
      const url = response.url();

      if (url.includes('/api/activities/todo') || url.includes('activities')) {
        try {
          const json = await response.json();
          const items = Array.isArray(json) ? json : (json.data || json.items || json.activities || json.todo || []);

          if (Array.isArray(items) && items.length > 0) {
            items.forEach((item) => {
              const tituloReal = item.title || item.nome || item.name;

              if (tituloReal && !tarefasInterceptadas.some(t => t.id === String(item.id))) {
                tarefasInterceptadas.push({
                  id: String(item.id || Math.random()),
                  plataforma: item.realm ? item.realm.toUpperCase() : 'Tarefa SP',
                  titulo: tituloReal.trim(),
                  descricao: item.description || item.learning_goals || 'Sem descrição cadastrada.',
                  prazo: item.task_expired ? 'Expirado' : 'A Fazer',
                  linkAcao: 'https://salvaestudante.com/tarefas'
                });
              }
            });
          }
        } catch (e) {
          // Ignora respostas sem JSON
        }
      }
    });

    console.log('2. Acessando salvaestudante.com para Login...');
    await page.goto('https://salvaestudante.com', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('3. Preenchendo campos de login...');
    await page.waitForSelector('input', { timeout: 15000 });

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

      const botoes = Array.from(document.querySelectorAll('button'));
      const btn = botoes.find(b => b.innerText && b.innerText.trim().toLowerCase().includes('acessar'));
      if (btn) btn.click();
    }, { raVal: ra, digitoVal: digito, ufVal: uf || 'SP', senhaVal: senha });

    console.log('4. Aguardando login e redirecionamento...');
    await new Promise(r => setTimeout(r, 4000));

    console.log('5. Acessando a URL exata da API obtida no F12...');
    // Faz o navegador navegar diretamente para a URL da API capturada para forçar o disparo com os cookies de sessão
    await page.goto('https://salvaestudante.com/api/activities/todo?type=NormalTask&includeDraft=true&includeExpired=true&expiredOnly=false&limit=20&offset=0', {
      waitUntil: 'networkidle2',
      timeout: 20000
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 2000));

    await browser.close();
    browser = null;

    console.log(`Finalizado! Capturadas ${tarefasInterceptadas.length} tarefas.`);

    const tarefasUnicas = Array.from(new Set(tarefasInterceptadas.map(t => t.id)))
      .map(id => tarefasInterceptadas.find(t => t.id === id));

    return res.json({
      sucesso: true,
      aluno: { nome: 'Estudante', turma: 'Turma Ativa' },
      resumo: {
        pendencias: tarefasUnicas.length > 0 ? tarefasUnicas.length.toString() : '0',
        faltas: '0 faltas'
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
    console.error('Erro na consulta:', error.message);
    return res.status(500).json({ erro: `Falha na consulta: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
