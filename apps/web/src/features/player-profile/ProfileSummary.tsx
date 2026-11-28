import { playerRadarAxisIds, radarMaximums } from '@who-ruined/contracts';
import { useTranslation } from 'react-i18next';
import { useFamilyLabels } from '../../entities/match/family-labels.js';
import { RadarChart, specializationAxis, useRadarLabels } from '../../entities/match/radar.js';
import type { PlayerProfile } from './api.js';
import { Metric } from './metrics.js';

export function ProfileSummary({ profile }: { profile: PlayerProfile }) {
  const { t } = useTranslation('player');
  const { t: tm } = useTranslation('match');
  const families = useFamilyLabels();
  const axes = useRadarLabels();
  const m = profile.measurements;
  const results = profile.results;
  const visibleAxes = playerRadarAxisIds.filter(axis => axis !== 'OBJECTIVES');
  const chartAxes = visibleAxes.map(axisId => {
    const axis = profile.radar.axes[axisId];
    return { axisId, caption: axisId === 'ASSISTS' ? t('radar-assists-caption', 'Assists') : axes[axisId],
      award: null, geometry: axis.value === null ? null : Math.min(1, axis.value / radarMaximums[axisId]),
      partial: axis.status === 'PARTIAL' };
  });
  return <>
    <section className="profile-section">
      <h2>{tm('awards-label', 'Match results')}</h2>
      <dl className="profile-metrics">
        <Metric label={t('profile-unique-matches', 'Unique matches')} value={profile.matchCount}/>
        <Metric label={t('profile-wins', 'Wins')} value={results.wins}/>
        <Metric label={t('profile-losses', 'Losses')} value={results.losses}/>
        <Metric label={t('profile-draws', 'Draws')} value={results.draws}/>
        <Metric label={t('unknown-result', 'Result unconfirmed')} value={results.unknown}/>
        <Metric label={t('profile-win-rate', 'Win rate')} value={results.winRate.value} datum={results.winRate} percent/>
      </dl>
    </section>
    <section className="profile-section">
      <h2>{tm('metrics-combat', 'Combat & survival')}</h2>
      <dl className="profile-metrics">
        <Metric label="K" value={m.kills.value} datum={m.kills}/>
        <Metric label="D" value={m.deaths.value} datum={m.deaths}/>
        <Metric label="A" value={m.assists.value} datum={m.assists}/>
        <Metric label="K/D" value={m.kd.value} datum={m.kd}/>
        <Metric label="ADR" value={m.adr.value} datum={m.adr}/>
        <Metric label="KAST" value={m.kast.value} datum={m.kast} percent/>
        <Metric label={tm('opening-kills', 'Opening K')} value={m.openingKills.value} datum={m.openingKills}/>
        <Metric label={tm('opening-deaths', 'Opening D')} value={m.openingDeaths.value} datum={m.openingDeaths}/>
        <Metric label={t('trades', 'Successful trades')} value={m.tradeKills.value} datum={m.tradeKills}/>
      </dl>
    </section>
    <section className="profile-section">
      <h2>{tm('metrics-clutches', 'Clutch wins & multi-kills')}</h2>
      <dl className="profile-metrics">
        <Metric label={t('important-double-kill', 'Double kill')} value={m.doubleKills.value} datum={m.doubleKills}/>
        <Metric label={t('important-triple-kill', 'Triple kill')} value={m.tripleKills.value} datum={m.tripleKills}/>
        <Metric label={t('important-four-kill', 'Four kills')} value={m.quadKills.value} datum={m.quadKills}/>
        <Metric label={t('important-ace', 'Ace')} value={m.aces.value} datum={m.aces}/>
        <Metric label={t('profile-clutch-wins', 'Clutch wins')} value={m.clutchWins.value} datum={m.clutchWins}/>
      </dl>
    </section>
    <section className="profile-section">
      <h2>{tm('metrics-grenades', 'Grenades')}</h2>
      <dl className="profile-metrics">
        <Metric label={tm('metrics-enemies-flashed', 'Enemies flashed')} value={m.enemiesFlashed.value} datum={m.enemiesFlashed}/>
        <Metric label={tm('metrics-enemy-blind', 'Enemy blind time (seconds)')} value={m.enemyBlindSeconds.value} datum={m.enemyBlindSeconds}/>
        <Metric label={tm('he-damage', 'HE damage')} value={m.heDamage.value} datum={m.heDamage}/>
        <Metric label={tm('fire-damage', 'Fire damage')} value={m.fireDamage.value} datum={m.fireDamage}/>
      </dl>
    </section>
    <section className="profile-section">
      <h2>{families.OBJECTIVES}</h2>
      <dl className="profile-metrics">
        <Metric label={tm('metrics-plants', 'Bomb plants')} value={m.bombPlants.value} datum={m.bombPlants}/>
        <Metric label={tm('metrics-defuses', 'Bomb defuses')} value={m.bombDefuses.value} datum={m.bombDefuses}/>
        <Metric label={t('profile-hostages', 'Hostage rescues')} value={m.hostageRescues.value} datum={m.hostageRescues}/>
      </dl>
    </section>
    <section className="profile-section">
      <h2>{t('profile-awards', 'Awards')}</h2>
      <dl className="profile-metrics">
        <Metric label="MVP" value={profile.awards.mvp.value} datum={profile.awards.mvp}/>
        <Metric label={t('who-ruined', 'Who Ruined')} value={profile.awards.whoRuined.value} datum={profile.awards.whoRuined}/>
        <Metric label="EVP" value={profile.awards.evp.value} datum={profile.awards.evp}/>
        {Object.entries(profile.awards.evpSpecializations).map(([key, count]) => {
          const specialization = specializationAxis[key as keyof typeof specializationAxis];
          return <Metric key={key} label={axes[specialization]} value={count}/>;
        })}
      </dl>
    </section>
    <section className="profile-section">
      <h2>H3</h2>
      {profile.ratings.map(({ rating, families: contributions, policy }) => <dl key={policy.digest} className="profile-metrics">
        <Metric label={t('profile-average-rating', 'Average rating')} value={rating.value} datum={rating}/>
        {contributions.map(({ family, contribution }) => <Metric key={family} label={families[family]} value={contribution.value} datum={contribution}/>)}
      </dl>)}
    </section>
    <section className="profile-section radar-panel">
      <h2>{t('radar-title', 'Player radar')}</h2>
      <RadarChart axes={chartAxes}/>
      <dl className="profile-metrics">{visibleAxes.map(axis => <Metric key={axis} label={<>{axes[axis]} <small>{
        axis === 'FLASH' ? t('radar-seconds', 'Seconds per verified round')
          : axis === 'UTILITY' ? t('radar-damage', 'Damage per verified round') : t('radar-per-ten', 'Per 10 verified rounds')
      }</small></>} value={profile.radar.axes[axis].value} datum={profile.radar.axes[axis]}/>)}</dl>
    </section>
  </>;
}
