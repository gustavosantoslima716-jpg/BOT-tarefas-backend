const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
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
    console.log('1. Iniciando Chromium...');
    
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('2. Acessando portal...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Processo de Login
    await page.waitForSelector('input', { timeout: 15000 });
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].type(ra + (digito || ''));
      await inputs[inputs.length - 1].type(senha);
    }

    const submitBtn = await page.$('button[type="submit"], button');
    if (submitBtn) {
      await Promise.all([
        submitBtn.click(),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
      ]);
    }

    console.log('3. Aguardando carregamento dos dados...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Extração direta do DOM sem depender da IA do Gemini
    console.log('4. Extraindo dados do painel...');
    const dadosExtraidos = await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // Extrai o nome após "Olá, "
      const matchNome = bodyText.match(/Olá,\s*([^\n]+)/i);
      const primeiroNome = matchNome ? matchNome[1].trim() : 'Aluno';

      // Captura o nome completo se presente no cabeçalho
      const matchCompleto = bodyText.match(/([A-Z\s]{5,})\n/);
      const nomeCompleto = matchCompleto ? matchCompleto[1].trim() : primeiroNome;

      // Captura a Turma (ex: 3ª Série H Noite Anual)
      const matchTurma = bodyText.match(/(\d+ª\s*Série[^\n]+)/i);
      const turma = matchTurma ? matchTurma[1].trim() : 'Turma não identificada';

      // Captura o número de Pendências (procura números perto de "Pendências")
      const matchPendencias = bodyText.match(/(\d+)\s*\n*\s*Pendências/i);
      const pendencias = matchPendencias ? matchPendencias[1] : '0';

      // Captura o número de Faltas
      const matchFaltas = bodyText.match(/(\d+)\s*\n*\s*Faltas/i);
      const faltas = matchFaltas ? `${matchFaltas[1]} faltas` : '0 faltas';

      return {
        aluno: {
          nome: primeiroNome,
          nomeCompleto: nomeCompleto,
          turma: turma
        },
        resumo: {
          pendencias: pendencias,
          faltas: faltas
        },
        tarefas: [
          {
            id: "1",
            plataforma: "Tarefa SP",
            titulo: `${pendencias} atividades pendentes na plataforma`,
            prazo: "Pendente"
          }
        ]
      };
    });

    await browser.close();

    return res.json({
      sucesso: true,
      ...dadosExtraidos
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar dados: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
