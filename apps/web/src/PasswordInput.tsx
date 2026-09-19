import { useEffect, useId, useState, type InputHTMLAttributes } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";

/** A labelled password input keeps its native validation/autocomplete and an independent visibility toggle. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!props.value) setVisible(false); }, [props.value]);
  return <span className="login-password-field">
    <input {...props} id={id} type={visible ? "text" : "password"} />
    <button type="button" className="icon secondary" disabled={props.disabled}
      aria-controls={id} aria-label={t("login.showPassword")} aria-pressed={visible}
      title={t(visible ? "login.hidePassword" : "login.showPassword")}
      onClick={() => setVisible(!visible)}>
      <Icon name={visible ? "eye-off" : "eye"} />
    </button>
  </span>;
}
