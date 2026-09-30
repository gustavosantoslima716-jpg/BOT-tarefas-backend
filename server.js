// 1. Faz login no salvaestudante.com
// ... (código de login)

// 2. Navega até a página de tarefas do Salva Estudante
await page.goto('https://salvaestudante.com/tarefas', { waitUntil: 'networkidle2' });

// 3. Aguarda os cards das tarefas aparecerem
await page.waitForSelector('.tarefa-card, [class*="card"]', { timeout: 10000 });

// 4. Extrai os dados dos cards de tarefa
const tarefas = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[class*="card"]')); // Ajuste o seletor conforme a classe real
  return cards.map(card => {
    const titulo = card.querySelector('h3, .titulo, strong')?.innerText || '';
    const prazo = card.querySelector('.prazo, [class*="status"]')?.innerText || '';
    return {
      plataforma: 'Tarefa SP',
      titulo: titulo,
      prazo: prazo
    };
  });
});
