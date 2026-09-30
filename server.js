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

    console.log('Extraindo estrutura exata da página...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    const dadosExtraidos = await page.evaluate(() => {
      // 1. Perfil e Iniciais
      const elNome = document.querySelector('.user-name, [class*="profile"], header span, h2');
      const nome = elNome ? elNome.innerText.trim() : 'ESTUDANTE';

      // 2. Extrai os Cards Principais do Topo (Pendências e Faltas)
      let pendenciasContador = '0';
      let faltasContador = '0';

      const todosBlocos = Array.from(document.querySelectorAll('div, section, p, span'));
      
      // Busca número de pendências
      todosBlocos.forEach(el => {
        const txt = el.innerText || '';
        if (txt.includes('Pendência') || txt.includes('Pendencias')) {
          const num = txt.match(/\d+/);
          if (num) pendenciasContador = num[0];
        }
        if (txt.includes('Faltas')) {
          const num = txt.match(/\d+/);
          if (num) faltasContador = num[0];
        }
      });

      // 3. Extrai Itens da Seção "Agenda" (as atividades do dia/semana)
      const tarefasAgenda = [];
      const itensAgenda = document.querySelectorAll('[class*="agenda"] div, [class*="Agenda"] div, li');

      itensAgenda.forEach(item => {
        const txt = item.innerText || '';
        const linhas = txt.split('\n').filter(l => l.trim().length > 0);
        
        // Se a estrutura tiver Data, Disciplina e Nome da Atividade
        if (linhas.length >= 2 && (txt.includes('/') || txt.includes('Ter') || txt.includes('Qua') || txt.includes('Ativ'))) {
          tarefasAgenda.push({
            plataforma: 'Tarefa SP / Agenda',
            titulo: linhas.slice(1).join(' - '),
            prazo: linhas[0] || 'Hoje'
          });
        }
      });

      // 4. Verifica Badges de Notificação nas Plataformas (ex: Redação Paulista com "1")
      const plataformas = document.querySelectorAll('a, button, [role="button"]');
      plataformas.forEach(plat => {
        const txt = plat.innerText || '';
        if (txt.includes('Redação') || txt.includes('LeiaSP') || txt.includes('Khan')) {
          const badge = plat.querySelector('[class*="badge"], span, div');
          if (badge && !isNaN(badge.innerText.trim())) {
            tarefasAgenda.push({
              plataforma: 'Redação Paulista',
              titulo: 'Nova Redação Pendente',
              prazo: 'Pendente'
            });
          }
        }
      });

      return {
        aluno: {
          nome: nome,
          turma: '3º D - EM HUMANAS'
        },
        resumo: {
          pendencias: pendenciasContador,
          faltas: faltasContador + ' faltas'
        },
        tarefas: tarefasAgenda
      };
    });

    await browser.close();
    return res.json({ sucesso: true, ...dadosExtraidos });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
