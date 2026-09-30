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
    console.log('1. Iniciando navegador leve...');
    
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    // Otimização: Bloqueia imagens, fontes e CSS para carregar a página em 1 segundo
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    let bearerToken = null;

    // Escuta a rede para capturar o Token do usuário no momento do login
    page.on('request', (request) => {
      const headers = request.headers();
      if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
        bearerToken = headers['authorization'];
      }
    });

    console.log('2. Acessando página de login...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Preenche login
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
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {})
      ]);
    }

    console.log('3. Capturando dados do perfil e realizando requisições diretas via API...');
    
    // Executa as chamadas de API direto do contexto da página logada (muito mais rápido que clicar)
    const resultadoAPI = await page.evaluate(async () => {
      const bodyText = document.body.innerText;
      const matchNome = bodyText.match(/Olá,\s*([^\n]+)/i);
      const matchTurma = bodyText.match(/(\d+ª\s*Série[^\n]+)/i);
      const matchFaltas = bodyText.match(/FALTAS \/ FREQUÊNCIA[\s\S]*?(\d+)/i) || bodyText.match(/(\d+)\s*\n*\s*Faltas/i);

      const alunoInfo = {
        nome: matchNome ? matchNome[1].trim() : 'Aluno',
        turma: matchTurma ? matchTurma[1].trim() : 'Turma Ativa',
        faltas: matchFaltas ? `${matchFaltas[1]} faltas` : '0 faltas'
      };

      // Função para consultar a API interna
      async function buscarEndpoint(url) {
        try {
          const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
          if (!res.ok) return [];
          const data = await res.json();
          return data.data || data.items || (Array.isArray(data) ? data : []);
        } catch (e) {
          return [];
        }
      }

      // Busca em paralelo todos os tipos de tarefas/pendências (expiradas ou no prazo)
      const endpoints = [
        '/api/todo?expired_only=false&limit=50',
        '/api/todo?expired_only=true&limit=50'
      ];

      const resultados = await Promise.all(endpoints.map(ep => buscarEndpoint(ep)));
      const todas = resultados.flat();

      return { alunoInfo, todas };
    });

    await browser.close();

    // Mapeia e padroniza as pendências encontradas
    const pendenciasMapeadas = resultadoAPI.todas.map((item, index) => ({
      id: String(item.id || `item_${index}`),
      plataforma: item.discipline_name || item.componente || item.categoria || 'Tarefa SP',
      titulo: item.title || item.nome || item.descricao || 'Atividade Pendente',
      prazo: item.due_date || item.data_limite || (item.expired ? 'Atrasada' : 'Pendente')
    }));

    // Remove duplicatas por título
    const pendenciasFinais = Array.from(new Set(pendenciasMapeadas.map(a => a.titulo)))
      .map(titulo => pendenciasMapeadas.find(a => a.titulo === titulo));

    console.log(`Sucesso em tempo recorde! ${pendenciasFinais.length} itens encontrados.`);

    return res.json({
      sucesso: true,
      aluno: {
        nome: resultadoAPI.alunoInfo.nome,
        turma: resultadoAPI.alunoInfo.turma
      },
      resumo: {
        pendencias: pendenciasFinais.length.toString(),
        faltas: resultadoAPI.alunoInfo.faltas
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
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
