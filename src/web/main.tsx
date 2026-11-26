import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { Layout } from './componentes/Layout';
import './estilos.css';
import { EmBreve } from './paginas/EmBreve';
import { Inicio } from './paginas/Inicio';
import { Projetos } from './paginas/Projetos';

const consultas = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const rotas = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Inicio /> },
      { path: 'projetos', element: <Projetos /> },
      {
        path: 'provedores',
        element: (
          <EmBreve
            titulo="Provedores e modelos"
            fase="F1"
            texto="Caminhos dos CLIs (Claude, Cursor, Antigravity, Codex), detecção de versão, catálogo de modelos com família, atributos e preços."
          />
        ),
      },
      {
        path: 'esteiras',
        element: (
          <EmBreve
            titulo="Esteiras"
            fase="F3"
            texto="Etapas por projeto (planejar, executar, revisar, testes, aprovação humana, etapas livres), com versões e regras de retentativa."
          />
        ),
      },
      {
        path: 'usage',
        element: (
          <EmBreve
            titulo="Usage"
            fase="F2 e F6"
            texto="Tokens e custo por run e por modelo, métricas de qualidade (aprovação na 1ª tentativa, precisão do revisor) e limites de assinatura."
          />
        ),
      },
      { path: '*', element: <EmBreve titulo="Página não encontrada" texto="Esse endereço não existe no painel." /> },
    ],
  },
]);

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <RouterProvider router={rotas} />
    </QueryClientProvider>
  </StrictMode>
);
