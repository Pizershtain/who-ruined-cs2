import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MatchReport } from '../components/MatchReport.js';
import { PlayerReport } from '../components/PlayerReport.js';
import { previewData, scenarios, type PreviewScenario } from './fixtures.js';
import { Icon } from '../components/Icon.js';
import StateGallery from './StateGallery.js';

export default function PreviewPage() {
  const params = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation('preview');
  const scenario = scenarios.find((item) => item === params.scenario) ?? 'available';
  const data = previewData(scenario);
  const labels: Record<PreviewScenario, string> = {
    available: t('calculated', 'Calculated ratings'),
    'low-confidence': t('low-confidence', 'Low confidence'),
    'insufficient-data': t('insufficient', 'Insufficient evidence'),
    m1: t('m1', 'Current match data'),
    partial: t('partial', 'Partial match'),
  };
  if (params.scenario === 'states') return <StateGallery/>;
  return <><aside className="preview-banner" role="note"><Icon name="warning"/><div><strong>{t('title', 'Design preview · synthetic data')}</strong><span>{t('description', 'Invented players, statistics and ratings. This is not a real demo analysis.')}</span></div><label><span className="sr-only">{t('scenario', 'Preview scenario')}</span><select value={scenario} onChange={(event) => navigate('/preview/' + event.target.value + (params.playerId ? '/players/' + encodeURIComponent(params.playerId) : ''))}>{scenarios.map((item) => <option value={item} key={item}>{labels[item]}</option>)}</select></label></aside>
    {params.playerId ? <PlayerReport key={scenario + params.playerId} match={data.match} playerId={params.playerId} base={'/preview/' + scenario} {...(data.analytics ? { analytics: data.analytics } : {})}/> : <MatchReport key={scenario} match={data.match} base={'/preview/' + scenario} {...(data.analytics ? { analytics: data.analytics } : {})}/>}
  </>;
}
