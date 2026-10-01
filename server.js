import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/consultar', async (req, res) => {
  const { cookie, authorization } = req.body;

  if (!cookie && !authorization) {
    return res.status(400).json({ 
      erro: 'Token/Cookie de sessão é obrigatório para consultar a Sala do Futuro.' 
    });
  }

  try {
    console.log('1. Conectando à API oficial da Sala do Futuro (educacao.sp.gov.br)...');

    // Requisição direta à API real da Sala do Futuro / CMSP
    const response = await axios.get(
      'https://saladofuturo.educacao.sp.gov.br/api/activities/todo?type=NormalTask&includeDraft=true&includeExpired=true&expiredOnly=false&limit=20&offset=0',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://saladofuturo.educacao.sp.gov.br/tarefas',
          'Origin': 'https://saladofuturo.educacao.sp.gov.br',
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
      plataforma: item.realm ? item.realm.toUpperCase() : 'Sala do Futuro',
      titulo: (item.title || item.nome || item.name || 'Tarefa').trim(),
      descricao: item.description || item.learning_goals || 'Sem descrição cadastrada.',
      prazo: item.task_expired ? 'Expirado' : 'A Fazer',
      linkAcao: 'https://saladofuturo.educacao.sp.gov.br/tarefas'
    }));

    console.log(`Sucesso! ${tarefasMapeadas.length} tarefas capturadas da Sala do Futuro.`);

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
    console.error('Erro na requisição para a Sala do Futuro:', error.message);
    
    // Tratamento caso o token/cookie cole expirado
    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(401).json({ 
        erro: 'Token ou Cookie expirado/inválido. Copie novamente a requisição no F12 da Sala do Futuro.' 
      });
    }

    return res.status(500).json({ 
      erro: `Falha ao buscar tarefas na Sala do Futuro: ${error.message}` 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
