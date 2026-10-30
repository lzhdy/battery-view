import dayjs from 'dayjs';

export const formatClock = (ts: number): string => dayjs(ts).format('HH:mm:ss');
