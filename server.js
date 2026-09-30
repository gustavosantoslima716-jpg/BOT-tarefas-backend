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

    // 1. Preenchimento de Login
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

    console.log('Extraindo informações da conta...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const dadosExtraidos = await page.evaluate(() => {
      // 1. Captura Nome do Aluno
      let nomeAluno = 'ESTUDANTE';
      const bodyText = document.body.innerText || '';
      const matchOla = bodyText.match(/Olá,\s*([A-Za-zÀ-ÖØ-öø-ÿ]+)/i);
      if (matchOla && matchOla[1]) {
        nomeAluno = matchOla[1].trim();
      }

      // 2. Captura Turma e Escola
      let turmaInfo = 'SALA DO FUTURO';
      const elTurma = document.querySelector('.info-turma, [class*="serie"], [class*="turma"]');
      if (elTurma) {
        turmaInfo = elTurma.innerText.replace(/\n/g, ' - ').trim();
      } else {
        const matchSerie = bodyText.match(/(\d+ª\s*Série[^\n]*)/i);
        if (matchSerie) turmaInfo = matchSerie[1].trim();
      }

      // 3. Captura Valor do Card de Faltas Exato
      let faltasVal = '0';
      const matchFaltas = bodyText.match(/(\d+)\s*\n?\s*Faltas/i);
      if (matchFaltas) {
        faltasVal = matchFaltas[1];
      }

      // 4. Captura Valor do Card de Pendências do Topo
      let pendenciasVal = '0';
      const matchPend = bodyText.match(/(\d+)\s*\n?\s*Pendências/i) || bodyText.match(/(\d+)\s*\n?\s*Pendência/i);
      if (matchPend) {
        pendenciasVal = matchPend[1];
      }

      // 5. Mapeia Badges Vermelhos (Notificações por plataforma)
      const tarefasLista = [];
      const redacoesLista = [];
      const provasLista = [];

      // Procura containers de plataformas
      const cardsPlataforma = document.querySelectorAll('div, a, button');
      cardsPlataforma.forEach(card => {
        const txt = card.innerText || '';
        
        // Tarefa SP
        if (txt.includes('Tarefa SP')) {
          const badge = card.querySelector('span, div, [class*="badge"], [class*="count"]');
          const num = badge ? parseInt(badge.innerText.trim()) : 0;
          if (!isNaN(num) && num > 0) {
            for (let i = 0; i < num; i++) {
              tarefasLista.push({
                plataforma: 'Tarefa SP',
                titulo: `Tarefa SP Pendente #${i + 1}`,
                prazo: 'A Fazer'
              });
            }
          }
        }

        // Redação Paulista
        if (txt.includes('Redação Paulista')) {
          const badge = card.querySelector('span, div, [class*="badge"], [class*="count"]');
          const num = badge ? parseInt(badge.innerText.trim()) : 0;
          if (!isNaN(num) && num > 0) {
            for (let i = 0; i < num; i++) {
              redacoesLista.push({
                plataforma: 'Redação Paulista',
                titulo: `Redação Pendente #${i + 1}`,
                prazo: 'A Fazer'
              });
            }
          }
        }
      });

      return {
        aluno: {
          nome: nomeAluno,
          turma: turmaInfo
        },
        resumo: {
          pendenciasTotais: parseInt(pendenciasVal) || (tarefasLista.length + redacoesLista.length),
          totalTarefas: tarefasLista.length,
          totalRedacoes: redacoesLista.length,
          totalProvas: provasLista.length,
          faltas: `${faltasVal} faltas`
        },
        listas: {
          tarefas: tarefasLista,
          redacoes: redacoesLista,
          provas: provasLista
        }
      };
    });

    await browser.close();

    // Retorna para o Lovable
    return res.json({
      sucesso: true,
      aluno: dadosExtraidos.aluno,
      resumo: {
        pendencias: dadosExtraidos.resumo.pendenciasTotais.toString(),
        faltas: dadosExtraidos.resumo.faltas
      },
      tarefas: [
        ...dadosExtraidos.listas.tarefas,
        ...dadosExtraidos.listas.redacoes,
        ...dadosExtraidos.listas.provas
      ]
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
