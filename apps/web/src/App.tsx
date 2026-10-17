import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { RouteError } from './components/RouteError.js';

const JobPage = lazy(() => import('./pages/JobPage.js').then(({ JobPage }) => ({ default: JobPage })));
const MatchPage = lazy(() => import('./pages/MatchPage.js').then(({ MatchPage }) => ({ default: MatchPage })));
const PlayerPage = lazy(() => import('./pages/PlayerPage.js').then(({ PlayerPage }) => ({ default: PlayerPage })));
const AboutPage = lazy(() => import('./pages/AboutPage.js').then(({ AboutPage }) => ({ default: AboutPage })));
const NotFoundPage = lazy(() => import('./pages/AboutPage.js').then(({ NotFoundPage }) => ({ default: NotFoundPage })));
const PreviewPage = import.meta.env.DEV ? lazy(() => import('./preview/PreviewPage.js')) : null;
export const router = createBrowserRouter([{
  element: <Layout/>, errorElement: <RouteError/>,
  children: [
    { path: '/', element: <HomePage/> },
    { path: '/jobs/:jobId', element: <JobPage/> },
    { path: '/matches/:matchId', element: <MatchPage/> },
    { path: '/matches/:matchId/players/:playerId', element: <PlayerPage/> },
    { path: '/about', element: <AboutPage/> },
    ...(PreviewPage ? [{ path: '/preview/:scenario?', element: <PreviewPage/> }, { path: '/preview/:scenario/players/:playerId', element: <PreviewPage/> }] : []),
    { path: '*', element: <NotFoundPage/> },
  ],
}]);
