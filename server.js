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

    // Array central onde consolidaremos todas as pendências
    const todasPendencias = [];

    // 1. Interceptador para APIs nativas da Sala do Futuro (Tarefas, Redações, Provas)
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
                plataforma: item.discipline_name || item.componente || item.categoria || 'Tarefa SP / Redação',
                titulo: item.title || item.nome || item.descricao || 'Atividade Pendente',
                prazo: item.due_date || item.data_limite || 'Pendente'
              });
            });
          }
        } catch (e) {
          // Ignora erros de parse se a resposta não for JSON
        }
      }
    });

    console.log('2. Acessando portal Sala do Futuro...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Realiza Login
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

    console.log('3. Coletando dados gerais do Aluno e Faltas...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    const dadosAluno = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const matchNome = bodyText.match(/Olá,\s*([^\n]+)/i);
      const primeiroNome = matchNome ? matchNome[1].trim() : 'Aluno';

      const matchTurma = bodyText.match(/(\d+ª\s*Série[^\n]+)/i);
      const turma = matchTurma ? matchTurma[1].trim() : 'Turma não identificada';

      const matchFaltas = bodyText.match(/FALTAS \/ FREQUÊNCIA[\s\S]*?(\d+)/i) || bodyText.match(/(\d+)\s*\n*\s*Faltas/i);
      const numFaltas = matchFaltas ? matchFaltas[1] : '0';

      return { nome: primeiroNome, turma, faltas: `${numFaltas} faltas` };
    });

    // 4. Navegação Sequencial: Clica na aba Tarefa SP
    console.log('4. Navegando para Tarefa SP...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a, button, div, span')).find(el => el.innerText && el.innerText.includes('Tarefa SP'));
      if (btn) btn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. Navegação Sequencial: Clica na aba Redação Paulista
    console.log('5. Navegando para Redação Paulista...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a, button, div, span')).find(el => el.innerText && el.innerText.includes('Redação'));
      if (btn) btn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 6. Navegação Sequencial: Clica na aba Provas
    console.log('6. Navegando para Provas...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a, button, div, span')).find(el => el.innerText && el.innerText.includes('Provas'));
      if (btn) btn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 7. Integração e Raspagem do Khan Academy (Tratando SSO Clever)
    console.log('7. Acessando Khan Academy...');
    try {
      // Abre o Khan Academy acionando a nova guia/popup ou redirecionamento
      const [khanPage] = await Promise.all([
        new Promise(resolve => browser.once('targetcreated', async target => resolve(await target.page()))),
        page.evaluate(() => {
          const khanBtn = Array.from(document.querySelectorAll('a, button, div')).find(el => el.innerText && el.innerText.includes('Khan Academy'));
          if (khanBtn) khanBtn.click();
        })
      ]).catch(() => [null]);

      const targetPage = khanPage || page;

      // Aguarda o Clever processar e redirecionar para o domínio final da Khan Academy
      console.log('Aguardando redirecionamento do Clever para o Khan Academy...');
      await targetPage.waitForFunction(() => window.location.href.includes('khanacademy.org'), { timeout: 25000 }).catch(() => {});
      await targetPage.waitForSelector('body', { timeout: 10000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Extrai os cursos/unidades pendentes do DOM da Khan Academy
      const itensKhan = await targetPage.evaluate(() => {
        const unidades = [];
        const elementos = document.querySelectorAll('a, div, li');
        
        elementos.forEach((el, index) => {
          const texto = el.innerText || '';
          // Busca blocos que possuem porcentagem de progresso ou botões de iniciar/retomar
          if (texto.includes('% Proficiente') && !texto.includes('100% Proficiente')) {
            const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
            if (linhas.length >= 2) {
              unidades.push({
                id: `khan_${index}`,
                plataforma: 'Khan Academy',
                titulo: linhas[0],
                prazo: `Progresso: ${linhas[1] || 'Em andamento'}`
              });
            }
          }
        });
        return unidades;
      });

      // Evita duplicatas do Khan Academy e insere no array
      const unidadesUnicas = Array.from(new Set(itensKhan.map(a => a.titulo)))
        .map(titulo => itensKhan.find(a => a.titulo === titulo));
      
      todasPendencias.push(...unidadesUnicas);

    } catch (errKhan) {
      console.log('Aviso ao capturar Khan Academy:', errKhan.message);
    }

    await browser.close();

    // Remove eventuais itens duplicados da lista completa
    const pendenciasFinais = Array.from(new Set(todasPendencias.map(a => a.titulo)))
      .map(titulo => todasPendencias.find(a => a.titulo === titulo));

    console.log(`Sucesso! Total de pendências encontradas: ${pendenciasFinais.length}`);

    return res.json({
      sucesso: true,
      aluno: {
        nome: dadosAluno.nome,
        nomeCompleto: dadosAluno.nome,
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
          prazo: "Em dia"
        }
      ]
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar dados: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
