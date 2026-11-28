import { useTranslation } from 'react-i18next';
import type { EvpSpecializationId, PlayerRadarAxisId } from '@who-ruined/contracts';

export function useRadarLabels(): Record<PlayerRadarAxisId, string> {
  const { t } = useTranslation('player');
  return {
    MULTIKILL: t('radar-multikill', 'Multi-kills'), CLUTCH: t('impact-clutch', 'Clutch'),
    ENTRY: t('radar-entry', 'Opening duels'), UTILITY: t('radar-utility', 'Utility'),
    TRADES: t('trades', 'Successful trades'), ASSISTS: t('assists-nonflash', 'Non-flash assists'),
    FLASH: t('source-flashes', { ns: 'match', defaultValue: 'Flashes' }), OBJECTIVES: t('family-objectives', 'Objectives'),
  };
}

export const specializationAxis: Record<EvpSpecializationId, PlayerRadarAxisId> = {
  FLASH_SUPPORT: 'FLASH', NON_FLASH_ASSIST_SUPPORT: 'ASSISTS', TRADE_SPECIALIST: 'TRADES', CLUTCH_SPECIALIST: 'CLUTCH',
  MULTIKILL_SPECIALIST: 'MULTIKILL', ENTRY_SPECIALIST: 'ENTRY', UTILITY_DAMAGE_SPECIALIST: 'UTILITY', OBJECTIVE_SPECIALIST: 'OBJECTIVES',
};

const chart = { width: 460, height: 340, x: 230, y: 170, radius: 110 };

function axisPoint(index: number, length: number, value: number) {
  const angle = index * 2 * Math.PI / length - Math.PI / 2;
  return { x: chart.x + Math.cos(angle) * value * chart.radius, y: chart.y + Math.sin(angle) * value * chart.radius };
}

type RadarChartAxis = { axisId: PlayerRadarAxisId; caption: string; geometry: number | null; partial: boolean; award: 'MVP' | 'EVP' | null };

export function RadarChart({ axes }: { axes: RadarChartAxis[] }) {
  const points = axes.map((axis, index) => axis.geometry === null ? null : axisPoint(index, axes.length, axis.geometry));
  return <div className="radar-chart" aria-hidden="true">
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`}>
      {[0.25, 0.5, 0.75, 1].map(radius => <circle key={radius} cx={chart.x} cy={chart.y} r={radius * chart.radius} className="radar-grid"/>)}
      {axes.map((axis, index) => {
        const end = axisPoint(index, axes.length, 1);
        const point = points[index];
        const nextIndex = (index + 1) % axes.length;
        const next = points[nextIndex];
        const partial = axis.partial || axes[nextIndex]?.partial;
        return <g key={axis.axisId}>
          <line x1={chart.x} y1={chart.y} x2={end.x} y2={end.y} className="radar-grid"/>
          {point && next && <path d={`M ${chart.x} ${chart.y} L ${point.x} ${point.y} L ${next.x} ${next.y} Z`} className="radar-area"/>}
          {point && next && <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} className={`radar-edge${partial ? ' radar-partial-edge' : ''}`}/>}
        </g>;
      })}
      {axes.map((axis, index) => {
        const point = points[index];
        return point && <circle key={axis.axisId} cx={point.x} cy={point.y} r={axis.award ? 5 : 4} className={axis.award === 'MVP' ? 'radar-mvp' : axis.award === 'EVP' ? 'radar-evp' : axis.partial ? 'radar-partial-point' : 'radar-point'}/>;
      })}
    </svg>
    {axes.map((axis, index) => {
      const label = axisPoint(index, axes.length, index === 0 ? 1.27 : 1.3);
      return <span key={axis.axisId} className="radar-axis-label" style={{ left: `${label.x / chart.width * 100}%`, top: `${label.y / chart.height * 100}%` }}>
        {axis.caption}{axis.award && <b className={`report-award ${axis.award.toLowerCase()}`}>{axis.award}</b>}
      </span>;
    })}
  </div>;
}
