export type Stat = {
  key: string;
  value: number;
  xpProgressPercent: number;
};

export type StatPanelProps = {
  fp: {
    current: number;
    max: number;
  };
  hp: {
    current: number;
    max: number;
  };
  stats: Stat[];
};

export type HomePageProps = StatPanelProps;
