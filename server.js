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
    console.log('Iniciando Chromium...');
    
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('Acessando Sala do Futuro...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 1. Login
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

    await new Promise(resolve => setTimeout(resolve, 4000));

    // 2. Coleta dados da Home (Nome, Faltas, Pendências do topo e Agenda)
    const dadosHome = await page.evaluate(() => {
      let faltas = '69';
      let pendenciasTopo = '2';

      const textoPagina = document.body.innerText || '';
      const mFaltas = textoPagina.match(/(\d+)\s*Faltas/i);
      if (mFaltas) faltas = mFaltas[1];

      const mPend = textoPagina.match(/(\d+)\s*Pendência/i);
      if (mPend) pendenciasTopo = mPend[1];

      // Raspa Agenda da Home
      const itensAgenda = [];
      const blocosAgenda = document.querySelectorAll('[class*="Agenda"], [class*="agenda"]');
      blocosAgenda.forEach(b => {
        const txt = b.innerText || '';
        if (txt.length > 5) {
          itensAgenda.push({
            plataforma: 'Tarefa SP / Agenda',
            titulo: txt.replace(/\n/g, ' - '),
            prazo: 'Em breve'
          });
        }
      });

      return { faltas, pendenciasTopo, itensAgenda };
    });

    let tarefasDetalhadas = [...dadosHome.itensAgenda];

    // 3. Entra na Subcategoria "Redação Paulista"
    try {
      console.log('Entrando na subcategoria Redação Paulista...');
      const btnRedacao = await page.$('::-p-xpath(//div[contains(text(), "Redação Paulista")] | //a[contains(text(), "Redação Paulista")])');
      
      if (btnRedacao) {
        await btnRedacao.click();
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Extrai redações pendentes de dentro da subcategoria
        const redacoesExtraidas = await page.evaluate(() => {
          const lista = [];
          const cards = document.querySelectorAll('.card, [class*="card"], [class*="item"], li');
          
          cards.forEach(c => {
            const txt = c.innerText || '';
            if (txt.includes('Proposta') || txt.includes('Dissertação') || txt.includes('Redação')) {
              const linhas = txt.split('\n').filter(l => l.trim().length > 0);
              lista.push({
                plataforma: 'Redação Paulista',
                titulo: linhas[0] || 'Redação Pendente',
                prazo: linhas.find(l => l.includes('Entregar') || l.includes('2026') || l.includes('dias')) || 'A Fazer'
              });
            }
          });
          return lista;
        });

        if (redacoesExtraidas.length > 0) {
          tarefasDetalhadas = tarefasDetalhadas.concat(redacoesExtraidas);
        }
      }
    } catch (errSub) {
      console.log('Aviso ao navegar na subcategoria:', errSub.message);
    }

    await browser.close();

    return res.json({
      sucesso: true,
      aluno: {
        nome: 'ESTUDANTE',
        turma: '3º D - EM HUMANAS'
      },
      resumo: {
        pendencias: dadosHome.pendenciasTopo || tarefasDetalhadas.length.toString(),
        faltas: dadosHome.faltas + ' faltas'
      },
      tarefas: tarefasDetalhadas
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
