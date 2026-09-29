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
    console.log('Iniciando o navegador Chromium...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Define um User-Agent real de navegador desktop
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('Acessando a página da Sala do Futuro...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Aguardando os campos de login carregarem...');
    await page.waitForSelector('input', { timeout: 15000 });

    // Preenche os campos
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      console.log('Preenchendo credenciais...');
      await inputs[0].type(ra + (digito || ''));
      await inputs[inputs.length - 1].type(senha);
    } else {
      throw new Error('Campos de login não foram localizados na página.');
    }

    // Procura e clica no botão de submissão
    console.log('Clicando no botão de login...');
    const submitBtn = await page.$('button[type="submit"], button');
    if (submitBtn) {
      await Promise.all([
        submitBtn.click(),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
      ]);
    }

    console.log('Página após login carregada. Extraindo informações...');
    
    // Tenta capturar elementos de tarefas ou mensagem do portal
    const tarefas = await page.evaluate(() => {
      const items = document.querySelectorAll('.card-tarefa, .atividade-item, div[class*="tarefa"]');
      return Array.from(items).map(item => ({
        plataforma: 'Sala do Futuro',
        titulo: item.querySelector('h3, .titulo, span')?.innerText || 'Atividade sem título',
        prazo: item.querySelector('.data, .prazo')?.innerText || 'Sem prazo'
      }));
    });

    await browser.close();
    return res.json({ sucesso: true, tarefas });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO DETALHADO NO PUPPETEER:', error.message);
    return res.status(500).json({ erro: `Falha ao processar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

