export const themes = {
  dark: { label: 'Tokyo Night', surface: '#151922', elevated: '#1d2430', inset: '#10141c', raised: '#283341', text: '#e5eaf0', muted: '#9aa8b8', line: '#3b495b', accent: '#4fb6b2', danger: '#d97878', warning: '#d4b176' },
  kanagawa: { label: 'Kanagawa', surface: '#1f1f28', elevated: '#2a2a37', inset: '#16161d', raised: '#363646', text: '#dcd7ba', muted: '#aaa899', line: '#54546d', accent: '#7e9cd8', danger: '#e46876', warning: '#e6c384' },
  gruvbox: { label: 'Gruvbox', surface: '#282828', elevated: '#32302f', inset: '#1d2021', raised: '#3c3836', text: '#ebdbb2', muted: '#bdae93', line: '#665c54', accent: '#b8bb26', danger: '#fb4934', warning: '#fabd2f' },
  catppuccin: { label: 'Catppuccin', surface: '#1e1e2e', elevated: '#313244', inset: '#181825', raised: '#45475a', text: '#cdd6f4', muted: '#a6adc8', line: '#585b70', accent: '#cba6f7', danger: '#f38ba8', warning: '#f9e2af' },
  light: { label: 'Light', surface: '#eef1f5', elevated: '#f8fafc', inset: '#e3e8ef', raised: '#ffffff', text: '#243041', muted: '#526174', line: '#a3b1c2', accent: '#216e6b', danger: '#a83d45', warning: '#805714' },
} as const;

export type ResolvedTheme = keyof typeof themes;
export type ThemeMode = ResolvedTheme | 'system';
export const themeModes: ThemeMode[] = ['dark', 'kanagawa', 'gruvbox', 'catppuccin', 'light', 'system'];
export const isThemeMode = (value: string | null): value is ThemeMode => themeModes.some(mode => mode === value);
