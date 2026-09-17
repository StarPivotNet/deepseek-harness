/** Copy dictionaries for the Usage settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '使用统计', title: '使用统计',
  intro: '跨全部会话汇总的本地用量。数字来自各会话日志中的提供方 token 报告与模型墙钟时间。',
  loading: '正在读取使用统计…', error: '暂时无法读取使用统计。', retry: '重试',
  empty: '还没有用量记录。完成一次模型回复后会出现在这里。',
  metricTokens: '累计 Token 数', metricPeakTokens: '峰值 Token 数', metricLongestChat: '最长聊天时长',
  metricCurrentStreak: '当前连续天数', metricLongestStreak: '最长连续天数',
  activity: 'Token 活动', activityDaily: '每日', activityWeekly: '每周', activityCumulative: '累计',
  range: '时间范围', range7: '近 7 日', range30: '近 30 日', trend: '每日 Token 趋势图', models: '模型用量',
  tokensUnit: 'tokens', daysUnit: '{value} 天', hoursMinutes: '{hours}小时{minutes}分', minutesOnly: '{minutes}分',
  'number.groupSeparator': ',', 'number.thousand': '{value}K', 'number.million': '{value}M',
  'number.wan': '{value}万', 'number.yi': '{value}亿',
  'month.1': '1月', 'month.2': '2月', 'month.3': '3月', 'month.4': '4月', 'month.5': '5月', 'month.6': '6月',
  'month.7': '7月', 'month.8': '8月', 'month.9': '9月', 'month.10': '10月', 'month.11': '11月', 'month.12': '12月',
} satisfies Record<string, string>
/** Usage settings locale key union. */
export type UsageSettingsKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Usage', title: 'Usage',
  intro: 'Local totals across every session. Figures come from provider token reports and model wall time in each session log.',
  loading: 'Reading usage…', error: 'Usage is temporarily unavailable.', retry: 'Retry',
  empty: 'No usage yet. Figures appear after a model reply lands.',
  metricTokens: 'Total tokens', metricPeakTokens: 'Peak tokens', metricLongestChat: 'Longest chat',
  metricCurrentStreak: 'Current streak', metricLongestStreak: 'Longest streak',
  activity: 'Token activity', activityDaily: 'Daily', activityWeekly: 'Weekly', activityCumulative: 'Cumulative',
  range: 'Time range', range7: 'Last 7 days', range30: 'Last 30 days', trend: 'Daily token trend', models: 'Model usage',
  tokensUnit: 'tokens', daysUnit: '{value} days', hoursMinutes: '{hours}h {minutes}m', minutesOnly: '{minutes}m',
  'number.groupSeparator': ',', 'number.thousand': '{value}K', 'number.million': '{value}M',
  'number.wan': '{value}万', 'number.yi': '{value}亿',
  'month.1': 'Jan', 'month.2': 'Feb', 'month.3': 'Mar', 'month.4': 'Apr', 'month.5': 'May', 'month.6': 'Jun',
  'month.7': 'Jul', 'month.8': 'Aug', 'month.9': 'Sep', 'month.10': 'Oct', 'month.11': 'Nov', 'month.12': 'Dec',
} satisfies Record<UsageSettingsKey, string>
