import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '../utils/cn';

export const ThemeToggle = ({ className }) => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check initial preference from localStorage or OS
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    } else {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    
    if (nextTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "flex items-center justify-between p-1 w-12 h-6 rounded-full transition-all duration-500 relative focus:outline-none border border-border shadow-inner bg-background/50 backdrop-blur-sm",
        className
      )}
      aria-label={isDark ? "Modo Claro" : "Modo Oscuro"}
    >
      <div 
        className={cn(
          "absolute left-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-surface shadow-float transition-all duration-500 border border-border",
          isDark ? "transform translate-x-6" : "transform translate-x-0"
        )}
      >
        {isDark ? <Moon size={10} className="text-accent" /> : <Sun size={10} className="text-amber-500" />}
      </div>
      
      <div className="flex w-full justify-around items-center px-1 opacity-20">
          <Sun size={10} className="text-primary" />
          <Moon size={10} className="text-primary" />
      </div>
    </button>
  );
};
