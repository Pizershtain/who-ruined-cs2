import { lazy } from 'react';
import { createBrowserRouter, createHashRouter } from 'react-router-dom';
import { demoBuild, previewEnabled } from './shared/env.js';
import { Layout } from './components/Layout.js';
import { LandingPage } from './pages/LandingPage.js';
import { RouteError } from './components/RouteError.js';

const HomePage = lazy(() => import('./pages/HomePage.js').then(({ HomePage }) => ({ default: HomePage })));
const JobPage = lazy(() => import('./pages/JobPage.js').then(({ JobPage }) => ({ default: JobPage })));
const MatchPage = lazy(() => import('./pages/MatchPage.js').then(({ MatchPage }) => ({ default: MatchPage })));
const PlayerPage = lazy(() => import('./pages/PlayerPage.js').then(({ PlayerPage }) => ({ default: PlayerPage })));
const AboutPage = lazy(() => import('./pages/AboutPage.js').then(({ AboutPage }) => ({ default: AboutPage })));
const NotFoundPage = lazy(() => import('./pages/AboutPage.js').then(({ NotFoundPage }) => ({ default: NotFoundPage })));
const PreviewPage = previewEnabled ? lazy(() => import('./preview/PreviewPage.js')) : null;
export const router = (demoBuild ? createHashRouter : createBrowserRouter)([{
  element: <Layout/>, errorElement: <RouteError/>,
  children: [
    { path: '/', element: <LandingPage/> },
    { path: '/analyze', element: <HomePage/> },
    { path: '/jobs/:jobId', element: <JobPage/> },
    { path: '/matches/:matchId', element: <MatchPage/> },
    { path: '/matches/:matchId/players/:playerId', element: <PlayerPage/> },
    { path: '/about', element: <AboutPage/> },
    ...(PreviewPage ? [{ path: '/preview/:scenario?', element: <PreviewPage/> }, { path: '/preview/:scenario/players/:playerId', element: <PreviewPage/> }] : []),
    { path: '*', element: <NotFoundPage/> },
  ],
}]);
