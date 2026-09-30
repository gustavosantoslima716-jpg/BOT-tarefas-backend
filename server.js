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
    console.log('1. Iniciando Chromium ultra-rápido...');
    
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

    // Intercepta e acumula as respostas JSON de Tarefas, Redações e Provas
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('todo?')) {
        try {
          const json = await response.json();
          const items = json.data || json.items || (Array.isArray(json) ? json : []);
          if (Array.isArray(items)) {
            items.forEach((item, index) => {
              todasPendencias.push({
                id: String(item.id || `item_${Date.now()}_${index}`),
                plataforma: item.discipline_name || item.componente || item.categoria || 'Tarefa / Atividade',
                titulo: item.title || item.nome || item.descricao || 'Atividade Pendente',
                prazo: item.due_date || item.data_limite || 'Pendente'
              });
            });
          }
        } catch (e) {}
      }
    });

    console.log('2. Acessando Sala do Futuro...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Realiza Login
    await page.waitForSelector('input', { timeout: 10000 });
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].type(ra + (digito || ''));
      await inputs[inputs.length - 1].type(senha);
    }

    const submitBtn = await page.$('button[type="submit"], button');
    if (submitBtn) {
      await Promise.all([
        submitBtn.click(),
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {})
      ]);
    }

    console.log('3. Extraindo dados do perfil...');
    const dadosAluno = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const matchNome = bodyText.match(/Olá,\s*([^\n]+)/i);
      const matchTurma = bodyText.match(/(\d+ª\s*Série[^\n]+)/i);
      const matchFaltas = bodyText.match(/FALTAS \/ FREQUÊNCIA[\s\S]*?(\d+)/i) || bodyText.match(/(\d+)\s*\n*\s*Faltas/i);

      return {
        nome: matchNome ? matchNome[1].trim() : 'Aluno',
        turma: matchTurma ? matchTurma[1].trim() : 'Turma Ativa',
        faltas: matchFaltas ? `${matchFaltas[1]} faltas` : '0 faltas'
      };
    });

    console.log('4. Disparando captura rápida das abas...');
    // Clica nas abas rapidamente apenas para disparar os endpoints de API em segundo plano
    await page.evaluate(() => {
      const elementos = Array.from(document.querySelectorAll('a, button, div, span'));
      const btnTarefas = elementos.find(el => el.innerText && el.innerText.includes('Tarefa SP'));
      const btnRedacao = elementos.find(el => el.innerText && el.innerText.includes('Redação'));
      const btnProvas = elementos.find(el => el.innerText && el.innerText.includes('Provas'));

      if (btnTarefas) btnTarefas.click();
      setTimeout(() => { if (btnRedacao) btnRedacao.click(); }, 800);
      setTimeout(() => { if (btnProvas) btnProvas.click(); }, 1600);
    });

    // Aguarda apenas 3 segundos para a captura das respostas de rede das 3 abas
    await new Promise(resolve => setTimeout(resolve, 3200));

    await browser.close();

    // Remove eventuais duplicados pelo título
    const pendenciasFinais = Array.from(new Set(todasPendencias.map(a => a.titulo)))
      .map(titulo => todasPendencias.find(a => a.titulo === titulo));

    console.log(`Concluído! ${pendenciasFinais.length} itens capturados.`);

    return res.json({
      sucesso: true,
      aluno: {
        nome: dadosAluno.nome,
        turma: dadosAluno.turma
      },
      resumo: {
        pendencias: pendenciasFinais.length.toString(),
        faltas: dadosAluno.faltas
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
    return res.status(500).json({ erro: `Falha na sincronização: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor a rodar na porta ${PORT}`));
