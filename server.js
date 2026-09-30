const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());
app.use(cors());

// Recupera a chave e garante que não seja enviada vazia
const apiKey = process.env.GEMINI_API_KEY || '';

if (!apiKey) {
  console.error('AVISO CRÍTICO: A variável GEMINI_API_KEY não foi encontrada no ambiente!');
} else {
  console.log('Chave GEMINI_API_KEY carregada com sucesso.');
}

const genAI = new GoogleGenerativeAI(apiKey);

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

    // Login
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

    console.log('3. Aguardando carregamento do painel...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Captura screenshot em base64
    console.log('4. Tirando screenshot do painel...');
    const screenshotBuffer = await page.screenshot({ encoding: 'base64', fullPage: false });
    await browser.close();

    // Processamento com a API do Gemini
    console.log('5. Analisando dados com Gemini AI...');
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
      Analise a imagem deste portal escolar e extraia as informações em formato JSON rigoroso:
      {
        "aluno": {
          "nome": "Primeiro nome do aluno",
          "nomeCompleto": "Nome completo do aluno",
          "turma": "Série e turma"
        },
        "resumo": {
          "pendencias": "Número exato do card de Pendências",
          "faltas": "Número exato do card de Faltas com a palavra faltas"
        },
        "tarefas": [
          {
            "id": "1",
            "plataforma": "Tarefa SP",
            "titulo": "Atividade Pendente #1",
            "prazo": "Pendente"
          }
        ]
      }
    `;

    const imagePart = {
      inlineData: {
        data: screenshotBuffer,
        mimeType: 'image/png'
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text();
    const dadosGemini = JSON.parse(responseText);

    return res.json({
      sucesso: true,
      ...dadosGemini
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar com Gemini: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
