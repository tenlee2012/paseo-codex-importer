import { defineTranslations } from "@getpaseo/plugin/client";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ptBR from "./locales/pt-BR.json";
import ru from "./locales/ru.json";
import zhCN from "./locales/zh-CN.json";

export const messages = defineTranslations({
  resources: { en, ar, es, fr, ja, ko, "pt-BR": ptBR, ru, "zh-CN": zhCN },
});
