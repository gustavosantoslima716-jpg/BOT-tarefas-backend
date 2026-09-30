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
    console.log('1. Iniciando navegador para Salva Estudante...');
    
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const todasPendencias = [];

    // Interceptador para capturar APIs de tarefas/atividades em segundo plano
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('todo') || url.includes('tarefa') || url.includes('redacao') || url.includes('api')) {
        try {
          const json = await response.json();
          const items = json.data || json.items || (Array.isArray(json) ? json : []);
          if (Array.isArray(items)) {
            items.forEach((item, index) => {
              todasPendencias.push({
                id: String(item.id || `item_${Date.now()}_${index}`),
                plataforma: item.discipline_name || item.componente || item.categoria || 'Tarefa SP',
                titulo: item.title || item.nome || item.descricao || 'Atividade Pendente',
                prazo: item.due_date || item.data_limite || 'Pendente'
              });
            });
          }
        } catch (e) {}
      }
    });

    console.log('2. Acessando salvaestudante.com...');
    await page.goto('https://salvaestudante.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Se houver tela de login, preenche os campos
    const inputExist = await page.$('input');     if (inputExist) {       const inputs = await page.$$('input');
      if (inputs.length >= 2) {
        await inputs[0].type(ra + (digito || ''));
        await inputs[inputs.length - 1].type(senha);

        const submitBtn = await page.$('button[type="submit"], button');
        if (submitBtn) {
          await Promise.all([
            submitBtn.click(),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {})
          ]);
        }
      }
    }

    console.log('3. Extraindo dados do perfil e cards da Home...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const dadosHome = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // Captura o nome (ex: Olá, MAISA)
      const matchNome = bodyText.match(/Olá,\s*([^\n]+)/i);
      // Captura a turma (ex: 2ª SERIE C NOITE ANUAL)
      const matchTurma = bodyText.match(/(\d+ª\s*SERIE[^\n]+)/i);
      // Captura o número de pendências e faltas dos cards
      const matchPendencias = bodyText.match(/(\d+)\s*\n*\s*Pendências/i);
      const matchFaltas = bodyText.match(/(\d+)\s*\n*\s*Faltas/i);

      return {
        nome: matchNome ? matchNome[1].trim() : 'Estudante',
        turma: matchTurma ? matchTurma[1].trim() : 'Turma Ativa',
        totalPendencias: matchPendencias ? matchPendencias[1] : '0',
        totalFaltas: matchFaltas ? `${matchFaltas[1]} faltas` : '0 faltas'
      };
    });

    console.log('4. Navegando pelas seções de Tarefas e Redações...');
    
    // Clica nos itens do menu ou navega diretamente pelas abas
    const navegarAba = async (textoAba) => {
      try {
        await page.evaluate((txt) => {
          const el = Array.from(document.querySelectorAll('a, button, div, span'))
            .find(e => e.innerText && e.innerText.trim().toLowerCase() === txt.toLowerCase());
          if (el) el.click();
        }, textoAba);
        await new Promise(resolve => setTimeout(resolve, 2500));
      } catch (e) {}
    };

    await navegarAba('Tarefas');
    await navegarAba('Redações');

    await browser.close();

    // Remove duplicados
    const pendenciasFinais = Array.from(new Set(todasPendencias.map(a => a.titulo)))
      .map(titulo => todasPendencias.find(a => a.titulo === titulo));

    return res.json({
      sucesso: true,
      aluno: {
        nome: dadosHome.nome,
        turma: dadosHome.turma
      },
      resumo: {
        pendencias: pendenciasFinais.length > 0 ? pendenciasFinais.length.toString() : dadosHome.totalPendencias,
        faltas: dadosHome.totalFaltas
      },
      tarefas: pendenciasFinais.length > 0 ? pendenciasFinais : [
        {
          id: "0",
          plataforma: "Geral",
          titulo: "Nenhuma atividade pendente encontrada!",
          prazo: "Tudo em dia"
        }
      ]
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha na consulta no Salva Estudante: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
