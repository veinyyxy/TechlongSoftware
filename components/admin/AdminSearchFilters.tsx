import Link from "next/link";

interface FilterOption {
  value: string;
  label: string;
}

interface AdminSearchFiltersProps {
  action: string;
  query: string;
  status: string;
  statusOptions: FilterOption[];
  queryPlaceholder: string;
}

export function AdminSearchFilters({
  action,
  query,
  status,
  statusOptions,
  queryPlaceholder,
}: AdminSearchFiltersProps) {
  return (
    <form action={action} className="filter-bar">
      <label className="filter-field">
        <span>搜索</span>
        <input
          defaultValue={query}
          maxLength={100}
          name="q"
          placeholder={queryPlaceholder}
          type="search"
        />
      </label>
      <label className="filter-field filter-field-compact">
        <span>状态</span>
        <select defaultValue={status} name="status">
          <option value="">全部状态</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button className="button button-dark button-small" type="submit">
        筛选
      </button>
      {(query || status) && (
        <Link className="button button-ghost button-small" href={action}>
          清除
        </Link>
      )}
    </form>
  );
}
