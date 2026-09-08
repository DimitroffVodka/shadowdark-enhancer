import { MODULE_ID } from "./module-id.mjs";
import { SETTING_GROUPS } from "./setting-groups.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A feature group's pop-out under Configure Settings → Shadowdark Enhancer.
 *
 * Renders the group's settings the way Foundry's own SettingsConfig does — a
 * DataField per setting handed to {{formGroup}} — so a Boolean is a checkbox,
 * a `range` is a slider, `choices` a select and `filePicker` a picker, with no
 * per-setting markup. Nested editor windows (Extra Gear, the guidelines table)
 * render as buttons, exactly like Foundry's own submenu rows.
 *
 * One subclass per group is minted by registerSettingGroups(): registerMenu
 * only ever does `new type().render(true)`, so the group must live on the
 * class, not the instance.
 */
export class SettingsGroupMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  /** The SETTING_GROUPS entry this window shows; set on each minted subclass. */
  static GROUP = null;

  /** Nested menu key → Application class, supplied by registerSettingGroups. */
  static MENU_TYPES = {};

  static DEFAULT_OPTIONS = {
    classes: ["sde-settings-group"],
    tag: "form",
    window: { contentClasses: ["standard-form"], resizable: true },
    position: { width: 720 },
    form: { handler: SettingsGroupMenu._onSubmit, closeOnSubmit: true },
    actions: {
      openMenu: SettingsGroupMenu._onOpenMenu,
      addFolder: SettingsGroupMenu._onAddFolder,
      removeFolder: SettingsGroupMenu._onRemoveFolder,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/settings-group.hbs`, scrollable: [".sde-sg-scroll"] },
  };

  async _prepareContext() {
    const sections = this.constructor.GROUP.sections.map((s) => ({
      label: s.label,
      entries: s.entries.map((e) =>
        typeof e === "string"
          ? this._settingEntry(game.settings.settings.get(`${MODULE_ID}.${e}`))
          : this._menuEntry(e),
      ),
    }));
    return { rootId: this.id, sections };
  }

  _menuEntry({ menu, icon }) {
    return {
      menu: true,
      key: menu,
      icon,
      label: `SDE.settings.${menu}.name`,
      hint: `SDE.settings.${menu}.hint`,
      buttonText: `SDE.settings.${menu}.label`,
    };
  }

  /** Mirrors the per-setting field build in SettingsConfig#_prepareCategoryData. */
  _settingEntry(setting) {
    const f = foundry.data.fields;
    let field;
    if (setting.type instanceof f.DataField) field = setting.type;
    else if (setting.type === Boolean) field = new f.BooleanField({ initial: setting.default ?? false });
    else if (setting.type === Number) {
      field = new f.NumberField({
        required: true, choices: setting.choices, initial: setting.default, ...(setting.range ?? {}),
      });
    } else if (setting.filePicker === "folder") {
      // One or more folders, comma-joined in the stored string, edited as a
      // list of Foundry folder pickers (see the template and _onSubmit).
      return {
        folders: true,
        name: `${setting.namespace}.${setting.key}`,
        label: game.i18n.localize(setting.name ?? ""),
        hint: game.i18n.localize(setting.hint ?? ""),
        values: String(game.settings.get(setting.namespace, setting.key) ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean),
      };
    } else if (setting.filePicker) {
      const categories = setting.filePicker === "imagevideo" ? ["IMAGE", "VIDEO"] : [setting.filePicker.toUpperCase()];
      field = new f.FilePathField({ required: true, blank: true, categories });
    } else field = new f.StringField({ required: true, choices: setting.choices });
    field.name = `${setting.namespace}.${setting.key}`;
    field.label ||= game.i18n.localize(setting.name ?? "");
    field.hint ||= game.i18n.localize(setting.hint ?? "");
    return { menu: false, field, input: setting.input, value: game.settings.get(setting.namespace, setting.key) };
  }

  static async _onOpenMenu(_event, button) {
    await new this.constructor.MENU_TYPES[button.dataset.key]().render(true);
  }

  static _onAddFolder(_event, button) {
    const row = document.createElement("div");
    row.className = "sde-sg-folder";
    row.innerHTML = `<file-picker type="folder"></file-picker>
      <button type="button" data-action="removeFolder" data-tooltip="${game.i18n.localize("SDE.settingsGroup.removeFolder")}">
        <i class="fa-solid fa-xmark" inert></i>
      </button>`;
    button.before(row);
    row.querySelector("input")?.focus();
  }

  static _onRemoveFolder(_event, button) {
    button.closest(".sde-sg-folder").remove();
  }

  /** Write the changed settings; prompt for a reload if one of them needs it. */
  static async _onSubmit(_event, form, formData) {
    // Folder lists are unnamed pickers; join them back into the stored string.
    for (const list of form.querySelectorAll("[data-folder-list]")) {
      formData.object[list.dataset.folderList] = [...list.querySelectorAll("file-picker")]
        .map((p) => p.value?.trim()).filter(Boolean).join(", ");
    }
    let reload = false;
    for (const [id, value] of Object.entries(formData.object)) {
      const setting = game.settings.settings.get(id);
      if (!setting || game.settings.get(setting.namespace, setting.key) === value) continue;
      await game.settings.set(setting.namespace, setting.key, value);
      reload ||= !!setting.requiresReload;
    }
    if (reload) await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  }
}

/**
 * Register one GM-only Configure Settings button per group, in SETTING_GROUPS
 * order. `menuTypes` maps each nested `{ menu }` key to the window it opens.
 */
export function registerSettingGroups(menuTypes) {
  SettingsGroupMenu.MENU_TYPES = menuTypes;
  for (const group of SETTING_GROUPS) {
    const name = `SDE.settings.${group.key}.name`;
    const Menu = class extends SettingsGroupMenu {
      static GROUP = group;
      static DEFAULT_OPTIONS = { id: `sde-settings-${group.key}`, window: { title: name, icon: group.icon } };
    };
    game.settings.registerMenu(MODULE_ID, group.key, {
      name,
      hint: `SDE.settings.${group.key}.hint`,
      label: `SDE.settings.${group.key}.label`,
      icon: group.icon,
      type: Menu,
      restricted: true,
    });
  }
}
