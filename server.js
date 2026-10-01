import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/tarefas', async (req, res) => {
  const { ra, digito, senha } = req.body;

  if (!ra || !digito || !senha) {
    return res.status(400).json({ erro: "Faltaram dados! Informe R/A, Dígito e Senha." });
  }

  let browser;
  try {
    console.log("🤖 Robô iniciando...");

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("🌐 Navegando para salvaestudante.com...");
    await page.goto('https://salvaestudante.com', { waitUntil: 'networkidle2' });

    console.log("🔑 Preenchendo credenciais...");
    await page.type('input[name="ra"], input[id="ra"]', ra);
    await page.type('input[name="digito"], input[id="digito"]', digito);
    await page.type('input[type="password"]', senha);

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    if (page.url().includes('login')) {
      throw new Error("Login falhou. Verifique R/A, Dígito e Senha.");
    }

    console.log("✅ Login feito! Buscando tarefas...");

    const tarefasBrutas = await page.evaluate(() => {
      return fetch('https://salvaestudante.com/api/tasks?status=active', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      }).then(r => r.json());
    });

    const tarefasLimpas = (Array.isArray(tarefasBrutas) ? tarefasBrutas : (tarefasBrutas.data || []))
      .filter(t => !t.answer_id || t.answer_status !== 'delivered')
      .map(t => ({
        titulo: t.title,
        professor: t.author,
        venceEm: new Date(t.expire_at).toLocaleDateString('pt-BR'),
        expirada: t.task_expired ? "SIM" : "NÃO",
        link: `https://salvaestudante.com/tarefas/${t.id}`,
        questoes: t.question_count
      }));

    return res.json({
      sucesso: true,
      total: tarefasLimpas.length,
      tarefas: tarefasLimpas
    });

  } catch (erro) {
    console.error("❌ Erro:", erro.message);
    return res.status(500).json({ 
      sucesso: false, 
      erro: erro.message 
    });
  } finally {
    if (browser) await browser.close();
    console.log("👋 Robô encerrado.");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
