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
    console.log('Iniciando Chromium...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('Acessando Sala do Futuro...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 1. Preenche Login
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

    console.log('Extraindo todo o conteúdo do portal...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Extrator Geral de Dados do Portal
    const conteudoCompleto = await page.evaluate(() => {
      // Nome e Informações
      const elNome = document.querySelector('.user-name, .nome-aluno, [class*="user"], [class*="nome"], header span, h2');
      const nome = elNome ? elNome.innerText.trim() : '';

      const elTurma = document.querySelector('.turma, .info-turma, [class*="turma"], [class*="escola"]');
      const turma = elTurma ? elTurma.innerText.trim() : '';

      // Raspa todos os cards disponíveis no painel
      const cards = document.querySelectorAll('.card, .card-tarefa, .atividade-item, [class*="card"], [class*="item"]');
      const tarefas = [];
      const redacoes = [];
      const provas = [];

      cards.forEach(card => {
        const txt = card.innerText || '';
        if (txt.length > 8 && !txt.includes('Menu') && !txt.includes('Sair')) {
          const itemData = {
            titulo: card.querySelector('h3, h4, .titulo, strong, span')?.innerText || txt.split('\n')[0],
            prazo: card.querySelector('.data, .prazo, time, [class*="data"]')?.innerText || 'Pendente',
            plataforma: 'Sala do Futuro'
          };

          const txtLower = txt.toLowerCase();
          if (txtLower.includes('redação') || txtLower.includes('leia sp')) {
            itemData.plataforma = 'Leia SP / Redação';
            redacoes.push(itemData);
          } else if (txtLower.includes('prova') || txtLower.includes('saresp') || txtLower.includes('avaliação')) {
            itemData.plataforma = 'Provas / Avaliações';
            provas.push(itemData);
          } else {
            if (txtLower.includes('khan')) itemData.plataforma = 'Khan Academy';
            if (txtLower.includes('alura')) itemData.plataforma = 'Alura';
            tarefas.push(itemData);
          }
        }
      });

      // Busca dados de Frequência/Faltas na página
      const elFaltas = document.querySelector('[class*="falta"], [class*="presenca"], [class*="frequencia"]');
      const faltasTexto = elFaltas ? elFaltas.innerText.trim() : '0 faltas registradas';

      return {
        aluno: {
          nome: nome || 'ESTUDANTE',
          turma: turma || 'REDE ESTADUAL - SEDUC'
        },
        resumo: {
          pendenciasTotais: tarefas.length + redacoes.length + provas.length,
          totalTarefas: tarefas.length,
          totalRedacoes: redacoes.length,
          totalProvas: provas.length,
          faltas: faltasTexto
        },
        listas: {
          tarefas,
          redacoes,
          provas
        }
      };
    });

    await browser.close();
    return res.json({ sucesso: true, ...conteudoCompleto });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
