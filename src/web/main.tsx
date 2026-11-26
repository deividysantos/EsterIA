import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { Layout } from './componentes/Layout';
import './estilos.css';
import { EmBreve } from './paginas/EmBreve';
import { Inicio } from './paginas/Inicio';
import { Modelos } from './paginas/Modelos';
import { Provedores } from './paginas/Provedores';
import { Run } from './paginas/Run';
import { Runs } from './paginas/Runs';
import { Usage } from './paginas/Usage';
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
      { path: 'provedores', element: <Provedores /> },
      { path: 'modelos', element: <Modelos /> },
      { path: 'runs', element: <Runs /> },
      { path: 'runs/:id', element: <Run /> },
      { path: 'usage', element: <Usage /> },
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
