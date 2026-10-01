import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/consultar', async (req, res) => {
  const { cookie, authorization } = req.body;

  try {
    console.log('1. Realizando chamada direta à API de tarefas...');

    const response = await axios.get(
      'https://salvaestudante.com/api/activities/todo?type=NormalTask&includeDraft=true&includeExpired=true&expiredOnly=false&limit=20&offset=0',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Cookie': cookie || '',
          'Authorization': authorization || ''
        },
        timeout: 10000
      }
    );

    const items = Array.isArray(response.data) 
      ? response.data 
      : (response.data?.data || response.data?.items || response.data?.activities || response.data?.todo || []);

    const tarefasMapeadas = items.map((item, idx) => ({
      id: String(item.id || idx + 1),
      plataforma: item.realm ? item.realm.toUpperCase() : 'Tarefa SP',
      titulo: (item.title || item.nome || item.name || 'Tarefa').trim(),
      descricao: item.description || item.learning_goals || 'Sem descrição cadastrada.',
      prazo: item.task_expired ? 'Expirado' : 'A Fazer',
      linkAcao: 'https://salvaestudante.com/tarefas'
    }));

    console.log(`Sucesso! ${tarefasMapeadas.length} tarefas capturadas.`);

    return res.json({
      sucesso: true,
      aluno: { nome: 'Estudante', turma: 'Turma Ativa' },
      resumo: {
        pendencias: tarefasMapeadas.length.toString(),
        faltas: '0 faltas'
      },
      tarefas: tarefasMapeadas
    });

  } catch (error) {
    console.error('Erro na requisição:', error.message);
    return res.status(500).json({ erro: `Falha ao buscar tarefas: ${error.message}` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
