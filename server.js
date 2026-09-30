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
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log('2. Acessando salvaestudante.com...');
    await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'networkidle2' });

    // Aguarda o carregamento das tarefas
    await page.waitForSelector('.tarefa-card, [class*="card"]', { timeout: 15000 }).catch(() => null);

    console.log('3. Extraindo dados...');
    const tarefas = await page.evaluate(() => {
      const elementos = Array.from(document.querySelectorAll('[class*="card"]'));
      return elementos.map((el) => ({
        plataforma: 'Tarefa SP',
        titulo: el.querySelector('h3, .titulo, strong')?.innerText || 'Sem título',
        prazo: el.querySelector('.prazo, [class*="status"]')?.innerText || 'Sem prazo',
      }));
    });

    await browser.close();

    return res.json({
      sucesso: true,
      aluno: { nome: 'Estudante', turma: 'Turma Ativa' },
      resumo: { pendencias: tarefas.length.toString(), faltas: '0' },
      tarefas: tarefas.length > 0 ? tarefas : [{ plataforma: 'Tarefa SP', titulo: 'Nenhuma pendência encontrada.', prazo: '-' }],
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('Erro no scraping:', error);
    return res.status(500).json({ erro: 'Falha ao consultar o Salva Estudante', detalhes: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
