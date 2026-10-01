import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/consultar', async (req, res) => {
  const { ra, digito, uf, senha } = req.body;

  if (!ra || !senha) {
    return res.status(400).json({ erro: 'RA e senha são obrigatórios.' });
  }

  let browser = null;

  try {
    console.log('1. Iniciando navegador...');
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    console.log('2. Acessando salvaestudante.com...');
    await page.goto('https://salvaestudante.com', { waitUntil: 'domcontentloaded', timeout: 25000 });

    console.log('3. Preenchendo campos de login...');
    await page.waitForSelector('input', { timeout: 15000 });

    await page.evaluate(({ raVal, digitoVal, ufVal, senhaVal }) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const inputRA = inputs.find(i => i.placeholder && i.placeholder.includes('0000')) || inputs[0];
      const inputDigito = inputs.find(i => i.placeholder === '0') || inputs[1];
      const inputSenha = inputs.find(i => i.type === 'password' || (i.placeholder && i.placeholder.toLowerCase().includes('senha'))) || inputs[inputs.length - 1];

      if (inputRA) {
        inputRA.value = raVal;
        inputRA.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (inputDigito) {
        inputDigito.value = digitoVal || '0';
        inputDigito.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (inputSenha) {
        inputSenha.value = senhaVal;
        inputSenha.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const selectUF = document.querySelector('select');
      if (selectUF && ufVal) {
        selectUF.value = ufVal.toUpperCase();
        selectUF.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const botoes = Array.from(document.querySelectorAll('button'));
      const btn = botoes.find(b => b.innerText && b.innerText.trim().toLowerCase().includes('acessar'));
      if (btn) btn.click();
    }, { raVal: ra, digitoVal: digito, ufVal: uf || 'SP', senhaVal: senha });

    console.log('4. Aguardando login ser processado...');
    await new Promise(r => setTimeout(r, 4000));

    console.log('5. Indo para /tarefas...');
    await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

    console.log('6. Lendo e extraindo os cards de tarefas da página...');
    await new Promise(r => setTimeout(r, 4000));

    // Aqui acontece a extração (varredura) direta do DOM/HTML da tela
    const tarefasExtraidas = await page.evaluate(() => {
      const lista = [];
      
      // Procura por blocos de cards, artigos ou divs principais
      const cards = Array.from(document.querySelectorAll('div, article, section, li')).filter(el => {
        const txt = el.innerText || '';
        // Considera um "card de tarefa" se tiver textos/palavras comuns em tarefas
        return txt.length > 20 && txt.length < 500 && (
          txt.toLowerCase().includes('expira') ||
          txt.toLowerCase().includes('prazo') ||
          txt.toLowerCase().includes('fazer') ||
          txt.toLowerCase().includes('tarefa') ||
          txt.toLowerCase().includes('matemática') ||
          txt.toLowerCase().includes('português') ||
          txt.toLowerCase().includes('história')
        );
      });

      cards.forEach((card, idx) => {
        const textoCompleto = card.innerText.trim();
        const linhas = textoCompleto.split('\n').filter(l => l.trim() !== '');

        if (linhas.length >= 1) {
          lista.push({
            id: String(idx + 1),
            plataforma: 'Tarefa SP',
            titulo: linhas[0] || 'Tarefa Escolar',
            descricao: linhas.slice(1).join(' - ') || 'Sem descrição cadastrada.',
            prazo: textoCompleto.toLowerCase().includes('expir') ? 'Expirado' : 'A Fazer',
            linkAcao: 'https://salvaestudante.com/tarefas'
          });
        }
      });

      return lista;
    });

    await browser.close();
    browser = null;

    // Remove duplicados pelo título
    const tarefasUnicas = Array.from(new Set(tarefasExtraidas.map(t => t.titulo)))
      .map(titulo => tarefasExtraidas.find(t => t.titulo === titulo));

    console.log(`Finalizado! Encontrados ${tarefasUnicas.length} cards na página.`);

    return res.json({
      sucesso: true,
      aluno: { nome: 'Estudante', turma: 'Turma Ativa' },
      resumo: {
        pendencias: tarefasUnicas.length > 0 ? tarefasUnicas.length.toString() : '0',
        faltas: '0 faltas'
      },
      tarefas: tarefasUnicas.length > 0 ? tarefasUnicas : [
        {
          id: "0",
          plataforma: "Tarefa SP",
          titulo: "Nenhuma atividade pendente encontrada!",
          descricao: "Todas as tarefas foram concluídas.",
          prazo: "Tudo em dia",
          linkAcao: "#"
        }
      ]
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('Erro na consulta:', error.message);
    return res.status(500).json({ erro: `Falha na consulta: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
