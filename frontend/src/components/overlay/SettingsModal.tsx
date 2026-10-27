"use client";

import { useState, ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import Modal from "./Modal";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTranslation } from "@/hooks/useTranslation";
import { locales, type Locale } from "@/i18n";
import { ConnectTab } from "@/components/settings/ConnectTab";
import { themes, type Theme } from "@/utils/theme";

// ============================================================================
// TYPES
// ============================================================================

type SettingsTab = "general" | "connect";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

const sectionLabel =
  "block text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-2.5";

const THEME_ICONS: Record<Theme, ReactNode> = {
  light: <Sun size={14} aria-hidden="true" />,
  dark: <Moon size={14} aria-hidden="true" />,
};

// ============================================================================
// COMPONENTS
// ============================================================================

/** One button per option; the arrow keys move the choice along. */
function RadioButtons<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className: string;
}): ReactNode {
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {options.map((option, idx) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            let next: number | null = null;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              next = (idx + 1) % options.length;
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              next = (idx - 1 + options.length) % options.length;
            }
            if (next !== null) {
              onChange(options[next].value);
              const parent = e.currentTarget.parentElement;
              if (parent) (parent.children[next] as HTMLElement)?.focus();
            }
          }}
          className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-[13px] font-bold break-keep transition-colors focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 outline-none ${
            value === option.value
              ? "bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One on/off row of the session settings: label and description, then the switch. */
function SessionSwitch({
  checked,
  label,
  description,
  onToggle,
}: {
  checked: boolean;
  label: string;
  description: string;
  onToggle: () => void;
}): ReactNode {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white border border-slate-200 cursor-pointer hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:hover:bg-slate-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      <div>
        <p className="text-slate-700 dark:text-slate-200 text-[13px] font-semibold">
          {label}
        </p>
        <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
          {description}
        </p>
      </div>
      <div
        className={`w-11 h-6 shrink-0 rounded-full relative transition-colors ${
          checked ? "bg-[#2ca056]" : "bg-slate-200 dark:bg-slate-700"
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </div>
    </div>
  );
}

export default function SettingsModal({
  isOpen,
  onClose,
  initialTab = "general",
}: SettingsModalProps): ReactNode {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Sync tab when initialTab changes (e.g. the empty office's connect button).
  // Adjust-state-during-render pattern: reinitializes from the prop without a
  // cascading setState-in-effect (react-hooks/set-state-in-effect).
  const [syncedInitialTab, setSyncedInitialTab] = useState(initialTab);
  if (syncedInitialTab !== initialTab) {
    setSyncedInitialTab(initialTab);
    setActiveTab(initialTab);
  }

  const autoFollowNewSessions = usePreferencesStore(
    (s) => s.autoFollowNewSessions,
  );
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const setAutoFollowNewSessions = usePreferencesStore(
    (s) => s.setAutoFollowNewSessions,
  );
  const showFloorColleagues = usePreferencesStore((s) => s.showFloorColleagues);
  const setShowFloorColleagues = usePreferencesStore(
    (s) => s.setShowFloorColleagues,
  );

  const { t } = useTranslation();

  const handleLanguageChange = (locale: Locale) => {
    setLanguage(locale);
  };

  const handleAutoFollowToggle = () => {
    setAutoFollowNewSessions(!autoFollowNewSessions);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dismissible={false}
      title={t("settings.title")}
      footer={
        <button
          onClick={onClose}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold rounded-lg transition-colors dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        >
          {t("modal.close")}
        </button>
      }
    >
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 bg-slate-100 rounded-xl dark:bg-slate-800">
        {(["general", "connect"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-1.5 rounded-lg text-[13px] font-bold transition-colors ${
              activeTab === tab
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t(`settings.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "general" && (
        <div className="space-y-6">
          {/* Language */}
          <div>
            <label className={sectionLabel}>{t("settings.language")}</label>
            <RadioButtons
              label={t("settings.language")}
              options={(Object.entries(locales) as [Locale, string][]).map(
                ([locale, label]) => ({ value: locale, label }),
              )}
              value={language}
              onChange={handleLanguageChange}
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            />
          </div>

          {/* Theme */}
          <div>
            <label className={sectionLabel}>{t("settings.theme")}</label>
            <RadioButtons
              label={t("settings.theme")}
              options={themes.map((value) => ({
                value,
                label: (
                  <>
                    {THEME_ICONS[value]}
                    {t(`settings.theme.${value}`)}
                  </>
                ),
              }))}
              value={theme}
              onChange={(value) => void setTheme(value)}
              className="grid grid-cols-2 gap-2"
            />
          </div>

          {/* Session Settings */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <label className={sectionLabel}>
              {t("settings.sessionBehavior")}
            </label>
            <div className="space-y-2">
              <SessionSwitch
                checked={autoFollowNewSessions}
                label={t("settings.autoFollow")}
                description={t("settings.autoFollowDesc")}
                onToggle={handleAutoFollowToggle}
              />
              <SessionSwitch
                checked={showFloorColleagues}
                label={t("settings.floorTogether")}
                description={t("settings.floorTogetherDesc")}
                onToggle={() =>
                  void setShowFloorColleagues(!showFloorColleagues)
                }
              />
            </div>
          </div>
        </div>
      )}
      {activeTab === "connect" && <ConnectTab />}
    </Modal>
  );
}
