const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(cors());

// O SDK do Google detecta automaticamente a variável process.env.GEMINI_API_KEY
const ai = new GoogleGenAI({});

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

    console.log('3. Aguardando carregamento da página...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Captura o print da tela em base64
    console.log('4. Tirando print do painel...');
    const screenshotBase64 = await page.screenshot({ encoding: 'base64', fullPage: false });
    await browser.close();

    // Chamada usando a nova API do Gemini 1.5 Flash
    console.log('5. Processando dados com Gemini AI...');
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: screenshotBase64,
              },
            },
            {
              text: `Analise o print deste portal e responda ESTRITAMENTE em formato JSON sem marcadores markdown adicionais:
              {
                "aluno": {
                  "nome": "Primeiro nome do aluno",
                  "nomeCompleto": "Nome completo",
                  "turma": "Série e turma"
                },
                "resumo": {
                  "pendencias": "Número exato do card de Pendências",
                  "faltas": "Número exato de faltas com a palavra faltas"
                },
                "tarefas": [
                  {
                    "id": "1",
                    "plataforma": "Tarefa SP",
                    "titulo": "Atividade Pendente #1",
                    "prazo": "Pendente"
                  }
                ]
              }`
            }
          ]
        }
      ]
    });

    // Limpa a resposta para garantir que seja um JSON válido
    let textResponse = response.text.trim();
    if (textResponse.startsWith('```json')) {
      textResponse = textResponse.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (textResponse.startsWith('```')) {
      textResponse = textResponse.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const dadosGemini = JSON.parse(textResponse);

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
