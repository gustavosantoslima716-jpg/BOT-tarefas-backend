const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.post('/api/consultar', async (req, res) => {
  const { ra, digito, uf, senha } = req.body;

  if (!ra || !senha) {
    return res.status(400).json({ erro: 'RA e senha são obrigatórios.' });
  }

  let browser;
  try {
    // Inicia o Chrome em segundo plano no servidor
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 1. Entra na Sala do Futuro
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2'
    });

    // 2. Preenche o Login
    await page.type('input[placeholder*="186735683"]', ra);
    await page.type('input[placeholder="0"]', digito || '0');
    await page.type('input[type="password"]', senha);

    // 3. Clica em Acessar
    await Promise.all([
      page.click('button:has-text("Acessar")'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    // Exemplo de estrutura para raspar tarefas do painel
    const tarefas = await page.evaluate(() => {
      const items = document.querySelectorAll('.card-tarefa, .atividade-item');
      return Array.from(items).map(item => ({
        plataforma: 'Sala do Futuro',
        titulo: item.querySelector('.titulo')?.innerText || 'Atividade',
        prazo: item.querySelector('.data')?.innerText || 'Sem prazo'
      }));
    });

    await browser.close();
    return res.json({ sucesso: true, tarefas });

  } catch (error) {
    if (browser) await browser.close();
    console.error(error);
    return res.status(500).json({ erro: 'Erro ao processar login ou extrair dados.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

