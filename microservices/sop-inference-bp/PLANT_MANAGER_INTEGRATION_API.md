# WUS D1 Plant Manager Integration API

本文件提供給外部 SOP Checker、MES、產線程式或其他服務，說明如何更新 WUS D1 Line 2 / Station 8 的即時 SOP 狀態，以及如何取得廠長版 Dashboard 資料。

## 1. 服務資訊

| 項目 | 值 |
|---|---|
| Base URL | `http://localhost:8300` |
| API 格式 | JSON over HTTP |
| Content-Type | `application/json` |
| 驗證 | 目前無 Token 或 API Key |
| 工廠 | `WUS D1` |
| 產線 | `Line 2` |
| 預設工站 ID | `station-8` |
| 預設攝影機 ID | `cam-08` |
| API 文件 | `http://localhost:8300/docs` |
| OpenAPI JSON | `http://localhost:8300/openapi.json` |
| 廠長版 UI | `http://localhost:8300/static/plant-manager-demo.html` |

正式跨主機連線時，請將 `localhost` 換成執行 SOP 服務主機的 IP 或 DNS 名稱，並確認 TCP 8300 port 可連線。

## 2. 資料流

```text
Cosmos /v1/chat/completions SSE
        │ 自動寫入動作描述
        ▼
SQLite plant_manager.db ◄── POST /v1/plant-manager/sop-checker
        │                         ▲
        │                         └── 外部 SOP Checker / MES
        ▼
GET /v1/plant-manager/dashboard
        │
        └── 廠長版 UI（每 2 秒更新）
```

外部程式應優先呼叫 API，不要直接修改 SQLite。API 會負責更新目前狀態、建立事件、完成循環，以及避免相同循環重複新增。

## 3. 更新 SOP Checker 狀態

### Endpoint

```http
POST /v1/plant-manager/sop-checker
Content-Type: application/json
```

完整網址：

```text
http://localhost:8300/v1/plant-manager/sop-checker
```

### Request 欄位

| 欄位 | 型別 | 必填 | 預設 | 說明 |
|---|---|---:|---|---|
| `station_id` | string | 否 | `station-8` | 工站唯一識別碼 |
| `camera_id` | string | 否 | `cam-08` | 攝影機唯一識別碼 |
| `action_id` | integer/null | 否 | `null` | SOP 步驟編號，本站為 1–6 |
| `action_name` | string/null | 否 | `null` | SOP 步驟名稱 |
| `status` | string | 否 | `in_progress` | 建議使用 `idle`、`in_progress`、`completed`、`error` |
| `cycle_id` | integer/null | 否 | `null` | 作業循環編號；同一工站內應唯一且遞增 |
| `cosmos_description` | string/null | 否 | `null` | Cosmos 原始動作描述；未提供時保留上一筆 |
| `confidence` | number/null | 否 | `null` | 允許 0–1 或 0–100；未提供時使用 `96.7` |
| `missing_detected` | integer[] | 否 | `[]` | 本次偵測到的漏步編號 |
| `misordered_detected` | integer[] | 否 | `[]` | 本次偵測到的錯序步驟編號 |
| `cycle_completed` | boolean | 否 | `false` | 是否已完成本循環 |
| `compliant` | boolean/null | 否 | `null` | 循環是否合規；完成時若未提供，系統依漏步／錯序自動判斷 |
| `duration_seconds` | number/null | 否 | `null` | 完整循環耗時，單位為秒且不可為負數 |
| `event_message` | string/null | 否 | `null` | 額外事件訊息；提供時會新增一筆 `sop_update` 事件 |

`confidence` 最大值為 100。送入 `0.967` 時會正規化為 `96.7`；送入 `96.7` 則維持 `96.7`。

### 範例 A：動作進行中

```json
{
  "station_id": "station-8",
  "camera_id": "cam-08",
  "action_id": 1,
  "action_name": "Loosen the screw (TOP)",
  "status": "in_progress",
  "cycle_id": 1001,
  "cosmos_description": "The operator is loosening the top screw.",
  "confidence": 96.7,
  "missing_detected": [],
  "misordered_detected": [],
  "cycle_completed": false
}
```

### 範例 B：偵測到錯序

```json
{
  "station_id": "station-8",
  "camera_id": "cam-08",
  "action_id": 4,
  "action_name": "Put on the covers (Second)",
  "status": "in_progress",
  "cycle_id": 1001,
  "misordered_detected": [4],
  "cycle_completed": false
}
```

這會在 `sop_events` 新增 `misordered_step`、`warning` 事件。

### 範例 C：完成一個合規循環

```json
{
  "station_id": "station-8",
  "camera_id": "cam-08",
  "action_id": 6,
  "action_name": "Put on the covers (Forth)",
  "status": "completed",
  "cycle_id": 1001,
  "missing_detected": [],
  "misordered_detected": [],
  "cycle_completed": true,
  "compliant": true,
  "duration_seconds": 218.4
}
```

相同 `station_id + cycle_id` 再次送入時會更新原循環，不會重複計數。

### 成功回應

HTTP `200 OK`，回傳完整 Dashboard snapshot：

```json
{
  "current": {
    "station_id": "station-8",
    "camera_id": "cam-08",
    "action_id": 1,
    "action_name": "Loosen the screw (TOP)",
    "status": "in_progress",
    "cycle_id": 1001,
    "cosmos_description": "The operator is loosening the top screw.",
    "confidence": 96.7,
    "checker_result": {
      "missing_detected": [],
      "misordered_detected": [],
      "cycle_completed": false,
      "compliant": null
    },
    "updated_at": "2026-07-16T04:00:00Z"
  },
  "kpi": {
    "completed_cycles": 0,
    "compliance_rate": 0.0,
    "exceptions": 0,
    "average_cycle_seconds": 0.0
  },
  "events": [],
  "confidence_source": "fallback"
}
```

時間欄位使用 UTC ISO 8601 格式。`Z` 代表 UTC；UI 會依瀏覽器時區顯示。

### curl

```bash
curl -X POST http://localhost:8300/v1/plant-manager/sop-checker \
  -H 'Content-Type: application/json' \
  -d '{
    "station_id": "station-8",
    "camera_id": "cam-08",
    "action_id": 1,
    "action_name": "Loosen the screw (TOP)",
    "status": "in_progress",
    "cycle_id": 1001,
    "confidence": 96.7
  }'
```

### Python

```python
import requests

payload = {
    "station_id": "station-8",
    "camera_id": "cam-08",
    "action_id": 1,
    "action_name": "Loosen the screw (TOP)",
    "status": "in_progress",
    "cycle_id": 1001,
    "confidence": 96.7,
    "missing_detected": [],
    "misordered_detected": [],
    "cycle_completed": False,
}

response = requests.post(
    "http://localhost:8300/v1/plant-manager/sop-checker",
    json=payload,
    timeout=5,
)
response.raise_for_status()
dashboard = response.json()
print(dashboard["current"])
```

## 4. 讀取 Dashboard

### Endpoint

```http
GET /v1/plant-manager/dashboard?station_id=station-8
```

### Query 欄位

| 欄位 | 型別 | 必填 | 預設 | 說明 |
|---|---|---:|---|---|
| `station_id` | string | 否 | `station-8` | 要查詢的工站 ID |

### curl

```bash
curl 'http://localhost:8300/v1/plant-manager/dashboard?station_id=station-8'
```

### Python 輪詢

```python
import time
import requests

url = "http://localhost:8300/v1/plant-manager/dashboard"

while True:
    response = requests.get(url, params={"station_id": "station-8"}, timeout=5)
    response.raise_for_status()
    data = response.json()
    print(data["current"], data["kpi"])
    time.sleep(2)
```

## 5. 錯誤回應

| HTTP 狀態 | 原因 |
|---|---|
| `200` | 成功 |
| `422` | JSON 欄位型別錯誤、`confidence` 超出 0–100，或 `duration_seconds` 為負數 |
| `500` | SQLite 或伺服器內部錯誤 |
| 連線失敗 | 服務未啟動、IP／port 錯誤或防火牆阻擋 |

FastAPI `422` 範例：

```json
{
  "detail": [
    {
      "type": "less_than_equal",
      "loc": ["body", "confidence"],
      "msg": "Input should be less than or equal to 100"
    }
  ]
}
```

建議外部程式遇到暫時性連線錯誤或 HTTP 500 時採指數退避重試；HTTP 422 應修正資料，不應持續重送相同內容。

## 6. 正式 SOP Action Config

SOP Checker 內部設定使用以下編號：

| Action ID | Checker 設定 | UI 顯示 |
|---:|---|---|
| 1 | `Loosen the screw - TOP` | `Loosen the screw (TOP)` |
| 2 | `Loosen the screw - BOT` | `Loosen the screw (BOT)` |
| 3 | `Put on the covers - Top` | `Put on the cover (Top)` |
| 4 | `Put on the covers - Second` | `Put on the cover (Second)` |
| 5 | `Put on the covers - Third` | `Put on the cover (Third)` |
| 6 | `Put on the covers - Forth` | `Put on the cover (Fourth)` |

Checker 設定刻意使用 `- TOP`，不在動作名稱內使用第二組括號，避免 parser 將 `(TOP)` 誤判為另一個 SOP 步驟。

目前沒有可跳過步驟，六步皆依序執行。

## 7. SQLite 資料庫

### 路徑

容器內：

```text
/tmp/nvds_sop_storage/plant_manager.db
```

Host：

```text
/home/spark/eason/VLM_SOP/microservices/sop-inference-bp/.runtime/media/plant_manager.db
```

Schema 原始檔：

```text
/home/spark/eason/VLM_SOP/microservices/sop-inference-bp/nvds_action_detector/plant_manager_schema.sql
```

### `station_state`

每個工站只有一筆目前狀態，`station_id` 是 Primary Key。新狀態使用 UPSERT 更新。

| 欄位 | SQLite 型別 | 說明 |
|---|---|---|
| `station_id` | TEXT PK | 工站 ID |
| `camera_id` | TEXT | 攝影機 ID |
| `action_id` | INTEGER | 目前 SOP 步驟 |
| `action_name` | TEXT | 步驟名稱 |
| `status` | TEXT | 目前狀態 |
| `cycle_id` | INTEGER | 目前循環編號 |
| `cosmos_description` | TEXT | Cosmos 原始描述 |
| `confidence` | REAL | 信心度百分比；目前 fallback 96.7 |
| `checker_result` | TEXT | JSON 字串 |
| `updated_at` | TEXT | UTC ISO 8601 |

### `sop_cycles`

保存已完成循環，用於計算完成數、合規率及平均週期。

| 欄位 | SQLite 型別 | 說明 |
|---|---|---|
| `id` | INTEGER PK | 自動編號 |
| `station_id` | TEXT | 工站 ID |
| `cycle_id` | INTEGER | 外部循環編號 |
| `compliant` | INTEGER | `1` 合規、`0` 不合規 |
| `duration_seconds` | REAL | 循環秒數 |
| `completed_at` | TEXT | 完成時間 |

Unique Key：`station_id, cycle_id`。

### `sop_events`

保存漏步、錯序及外部自訂事件。

| 欄位 | SQLite 型別 | 說明 |
|---|---|---|
| `id` | INTEGER PK | 自動編號 |
| `station_id` | TEXT | 工站 ID |
| `camera_id` | TEXT | 攝影機 ID |
| `event_type` | TEXT | `missing_step`、`misordered_step` 或 `sop_update` |
| `severity` | TEXT | `critical`、`warning` 或 `info` |
| `action_id` | INTEGER | 發生事件時的步驟 |
| `cycle_id` | INTEGER | 所屬循環 |
| `message` | TEXT | 事件訊息 |
| `payload` | TEXT | Checker 結果 JSON 字串 |
| `created_at` | TEXT | UTC ISO 8601 |

### 唯讀 SQL 範例

其他程式若只做報表，可以唯讀查詢；寫入仍應使用 API。

```sql
SELECT *
FROM station_state
WHERE station_id = 'station-8';

SELECT *
FROM sop_events
WHERE station_id = 'station-8'
ORDER BY created_at DESC
LIMIT 20;

SELECT
  COUNT(*) AS completed_cycles,
  AVG(compliant) * 100 AS compliance_rate,
  AVG(duration_seconds) AS average_cycle_seconds
FROM sop_cycles
WHERE station_id = 'station-8'
  AND date(completed_at, 'localtime') = date('now', 'localtime');
```

SQLite 檔案由容器使用者 UID 1001 建立。若另一支程式在不同帳號或容器內直接讀取，必須確認檔案權限與 volume mount；透過 HTTP API 則不受此限制。

## 8. Cosmos 描述與信心度

現有 Cosmos SSE 回傳包含：

- Cosmos 文字描述
- `chunk_idx`
- `start_time` / `end_time`
- `vlm_execute_time`
- `cv_boundary_score`
- `checker_result`

目前沒有 Cosmos 動作分類信心度。`cv_boundary_score` 是 DDM 邊界分數，不等於 Cosmos 信心度，因此不應拿來替代。未收到 `confidence` 時，Dashboard 使用 `96.7`。

廠長版 UI 載入後會直接對目前 RTSP 建立 `/v1/chat/completions` SSE，將 `cosmos_2` 每個非空推論結果立即顯示。服務同時把該描述自動寫入 `station_state`，外部程式不必重複轉送；若外部程式有更完整的描述或真正信心度，仍可透過 SOP Checker API 覆蓋。

## 9. 整合建議

1. 外部程式以 `station_id + cycle_id` 識別循環。
2. 每次步驟變更時 POST 一次；相同動作持續進行時不必每幀重送。
3. 完成循環一定要送 `cycle_completed: true` 與 `cycle_id`，否則 KPI 不會增加。
4. 有漏步或錯序時分別填入 `missing_detected`、`misordered_detected`。
5. 使用 3–5 秒 HTTP timeout，暫時性錯誤採退避重試。
6. 寫入只走 API；SQLite 直接存取僅限唯讀報表。
