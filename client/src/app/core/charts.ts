// FusionCharts setup: register the core library, the standard chart pack and the Fusion theme once.
import { FusionChartsModule } from 'angular-fusioncharts';
import * as FusionCharts from 'fusioncharts';
import * as Charts from 'fusioncharts/fusioncharts.charts';
import * as FusionTheme from 'fusioncharts/themes/fusioncharts.theme.fusion';

FusionChartsModule.fcRoot(FusionCharts, Charts, FusionTheme);


const PALETTE = '#2563eb,#16a34a,#f59e0b,#dc2626,#7c3aed,#0891b2,#db2777,#65a30d';

export interface Point { label: string; value: number; }

export function singleSeries(caption: string, data: Point[], extra: Record<string, unknown> = {}) {
  return {
    chart: { caption, theme: 'fusion', paletteColors: PALETTE, showValues: 0, bgColor: '#ffffff', ...extra },
    data: data.map((d) => ({ label: d.label, value: d.value })),
  };
}

export function multiSeries(caption: string, labels: string[], series: { name: string; values: number[]; color?: string }[],
  extra: Record<string, unknown> = {}) {
  return {
    chart: { caption, theme: 'fusion', paletteColors: PALETTE, showValues: 0, bgColor: '#ffffff', ...extra },
    categories: [{ category: labels.map((label) => ({ label })) }],
    dataset: series.map((s) => ({ seriesname: s.name, color: s.color, data: s.values.map((value) => ({ value })) })),
  };
}
