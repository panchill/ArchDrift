import type { CalmModel } from "./types";
import type { ErrorBody } from "./api";

export const STATUS_TEXT: Record<number, string> = {
  400: "Модель не прошла проверку. Проверьте формат CALM 1.2 и содержимое файла.",
  409: "Модель успела обновиться. Загрузите файл ещё раз.",
  413: "Файл больше допустимого размера. Максимум — 16 МБ.",
  415: "Нужен файл CALM 1.2 в формате JSON.",
  503: "Сервер временно недоступен. Попробуйте ещё раз.",
};
export const MESSAGES: Record<string, string> = {
  "expected UTF-8 JSON": "Нужен JSON в кодировке UTF-8.",
  "expected one valid JSON document": "Нужен один корректный JSON-документ.",
  "expected CALM 1.2 schema URL": "Укажите схему CALM 1.2 в поле $schema.",
  "expected a non-negative int64 revision": "Версия должна быть целым неотрицательным числом.",
  "expected 1 to 1000 nodes": "Модель должна содержать от 1 до 1000 узлов.",
  "expected an array of at most 10000 relationships": "Нужен список не более чем из 10 000 связей.",
  "at least one service is required": "Добавьте хотя бы один сервис.",
  "expected a non-empty unique node ID": "Задайте непустой уникальный ID узла.",
  "expected a non-empty unique interface ID": "Задайте непустой уникальный ID интерфейса.",
  "expected a non-empty unique relationship ID": "Задайте непустой уникальный ID связи.",
  "unknown node reference": "Указанного узла нет в модели. Проверьте ссылку на узел.",
  "unknown or duplicate interface reference": "Интерфейс не найден или указан несколько раз.",
  "expected a non-empty list of service interface IDs": "Укажите непустой список интерфейсов сервиса.",
  "unsupported node type": "Этот тип узла не поддерживается.",
  "unsupported operation type": "Этот тип операции не поддерживается.",
  "unsupported protocol": "Этот протокол не поддерживается.",
  "relationship endpoints, protocol and type are incompatible": "Узлы связи, протокол и тип операции несовместимы.",
  "expected exactly one of connects or composed-of": "Укажите один тип связи: connects или composed-of.",
  "only connects and composed-of are supported": "Поддерживаются только connects и composed-of.",
  "container must reference a service": "Контейнер должен ссылаться на сервис.",
  "children must reference workers": "Дочерние узлы должны быть воркерами.",
  "worker must have exactly one owner": "Воркер должен принадлежать ровно одному сервису.",
  "each worker must belong to exactly one service": "Каждый воркер должен принадлежать ровно одному сервису.",
  "expected an object": "Значение должно быть объектом.",
  "expected a binding object": "Добавьте объект привязки metadata.archdrift.",
  "unknown binding field": "Неизвестное поле привязки к телеметрии.",
  "duplicate canonical binding": "Такая привязка к телеметрии уже существует.",
  "interfaces are only supported on services": "Интерфейсы можно указывать только у сервисов.",
  "external interface definitions are not supported": "Внешние определения интерфейсов не поддерживаются.",
  "expected an uppercase HTTP method": "Укажите HTTP-метод заглавными буквами, например POST.",
  "route must start with /": "Маршрут должен начинаться с /.",
  "service name must not have surrounding whitespace or line breaks": "Имя сервиса не должно содержать переносы строк или пробелы по краям.",
  "canonical ID exceeds 2048 characters": "Идентификатор привязки длиннее 2048 символов.",
  "not supported by the ArchDrift profile": "Не поддерживается профилем ArchDrift.",
  "not supported": "Не поддерживается профилем ArchDrift.",
};
const parts = (field: string) => field.replace(/\[(\d+)\]/g, "/$1").split(/[/.]/).filter(Boolean).map(s => s.replace(/~1/g, "/").replace(/~0/g, "~"));
export function shortPath(field: string) {
  return parts(field).join(".").replace(/\.(\d+)/g, "[$1]").replace(/\.relationship-type\.connects\.destination/, " → назначение").replace(/\.relationship-type\.connects\.source/, " → источник");
}
export function translate(details: NonNullable<ErrorBody["details"]>, model: CalmModel) {
  return details.map(({ field, message }) => {
    const p = parts(field);
    let place = "Модель";
    if (p[0] === "relationships" && /^\d+$/.test(p[1])) {
      place = `Связь ${model.relationships[Number(p[1])]?.["unique-id"] ?? Number(p[1]) + 1}`;
    } else if (p[0] === "nodes" && /^\d+$/.test(p[1])) {
      const node = model.nodes[Number(p[1])];
      place = `Узел ${node?.["unique-id"] ?? Number(p[1]) + 1}`;
      if (p[2] === "interfaces" && /^\d+$/.test(p[3])) place += `, интерфейс ${node?.interfaces?.[Number(p[3])]?.["unique-id"] ?? Number(p[3]) + 1}`;
    }
    const length = message.match(/^expected a string of 1 to (\d+) characters$/);
    return { place, path: shortPath(field), message: MESSAGES[message] ?? (length ? `Нужна строка длиной от 1 до ${length[1]} символов.` : "Не соответствует схеме CALM 1.2.") };
  });
}
