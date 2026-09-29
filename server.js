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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('Acessando Sala do Futuro...');
    await page.goto('https://saladofuturo.educacao.sp.gov.br/login-alunos', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Preenche login
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

    console.log('Extraindo informações do aluno e resumo...');
    await page.waitForTimeout(3000);

    // Extrai dados da dashboard
    const dadosDashboard = await page.evaluate(() => {
      // Tenta extrair o nome do aluno da página
      const elementoNome = document.querySelector('.nome-aluno, .user-name, [class*="aluno"], [class*="user"], h2, h3');
      const nomeCompleto = elementoNome ? elementoNome.innerText.trim() : 'ALUNO';

      // Tenta extrair a série / escola
      const elementoInfo = document.querySelector('.info-turma, .subtitulo, [class*="turma"], [class*="escola"]');
      const turmaInfo = elementoInfo ? elementoInfo.innerText.trim() : 'SEDUC-SP';

      // Conta o total de atividades pendentes
      const cardsTarefas = document.querySelectorAll('.card-tarefa, .atividade-item, [class*="tarefa"]');
      const totalPendencias = cardsTarefas.length;

      // Lista detalhada dos itens
      const tarefas = Array.from(cardsTarefas).map(item => ({
        plataforma: item.innerText.toLowerCase().includes('khan') ? 'Khan Academy' : 'Tarefas SP',
        titulo: item.querySelector('h3, h4, .titulo, span')?.innerText || 'Atividade Pendente',
        prazo: item.querySelector('.data, .prazo, time')?.innerText || 'Pendente'
      }));

      return {
        aluno: {
          nome: nomeCompleto,
          turma: turmaInfo
        },
        resumo: {
          pendencias: totalPendencias,
          faltas: '—'
        },
        tarefas: tarefas
      };
    });

    await browser.close();
    return res.json({ sucesso: true, ...dadosDashboard });

  } catch (error) {
    if (browser) await browser.close();
    console.error('ERRO:', error.message);
    return res.status(500).json({ erro: `Falha ao processar: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
          
