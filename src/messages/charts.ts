/**
 * Chart types for agent UI
 */

export type ChartType = "line" | "bar" | "pie" | "area";

export interface IChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface IChartDataset {
  label: string;
  data: IChartDataPoint[];
  color?: string;
}

export interface IChartValue {
  type: ChartType;
  title: string;
  description?: string;
  datasets: IChartDataset[];
  options?: {
    showLegend?: boolean;
    showGrid?: boolean;
    currency?: boolean;
    percentage?: boolean;
    [key: string]: any;
  };
}
