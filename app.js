class DuckDBUI {
    constructor() {
        this.db = null;
        this.conn = null;
        this.isConnected = false;
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.connectBtn = document.getElementById('connectBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.executeBtn = document.getElementById('executeBtn');
        this.exportBtn = document.getElementById('exportBtn');
        this.fileInput = document.getElementById('fileInput');
        this.sqlQuery = document.getElementById('sqlQuery');
        this.resultsContainer = document.getElementById('resultsContainer');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.queryTime = document.getElementById('queryTime');
        this.resultCount = document.getElementById('resultCount');
    }

    bindEvents() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.clearBtn.addEventListener('click', () => this.clearQuery());
        this.executeBtn.addEventListener('click', () => this.executeQuery());
        this.exportBtn.addEventListener('click', () => this.exportResults());
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        
        this.sqlQuery.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                this.executeQuery();
            }
        });
    }

    async connect() {
        try {
            this.updateStatus('Connecting...', 'connecting');
            this.connectBtn.disabled = true;
            this.connectBtn.textContent = 'Connecting...';

            const MANUAL_BUNDLES = {
                mvp: {
                    mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-mvp.wasm',
                    mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-browser-mvp.worker.js'
                }
            };

            const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
            
            const worker_url = URL.createObjectURL(
                new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'text/javascript'})
            );
            
            const worker = new Worker(worker_url);
            const logger = new duckdb.ConsoleLogger();
            this.db = new duckdb.AsyncDuckDB(logger, worker);
            await this.db.instantiate(bundle.mainModule);
            this.conn = await this.db.connect();
            
            URL.revokeObjectURL(worker_url);

            this.isConnected = true;
            this.updateStatus('Connected', 'connected');
            this.executeBtn.disabled = false;
            this.connectBtn.textContent = 'Connected';
            this.connectBtn.disabled = true;

            await this.executeQuery('SELECT \'Welcome to DuckDB WASM!\' as message');
        } catch (error) {
            console.error('Connection failed:', error);
            this.updateStatus('Connection failed', 'error');
            this.connectBtn.disabled = false;
            this.connectBtn.textContent = 'Retry Connection';
            this.showError(`Connection failed: ${error.message}`);
        }
    }

    async executeQuery(query = null) {
        if (!this.isConnected) {
            this.showError('Please connect to DuckDB first');
            return;
        }

        const sql = query || this.sqlQuery.value.trim();
        if (!sql) {
            this.showError('Please enter a SQL query');
            return;
        }

        try {
            this.updateStatus('Executing query...', 'executing');
            const startTime = Date.now();
            
            const result = await this.conn.query(sql);
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            this.displayResults(result);
            this.updateStatus('Connected', 'connected');
            this.queryTime.textContent = `Query executed in ${executionTime}ms`;
            this.exportBtn.disabled = false;
            this.lastResult = result;
        } catch (error) {
            console.error('Query execution failed:', error);
            this.showError(`Query failed: ${error.message}`);
            this.updateStatus('Query failed', 'error');
        }
    }

    displayResults(result) {
        if (!result || result.numRows === 0) {
            this.resultsContainer.innerHTML = '<div class="no-results">No results returned</div>';
            this.resultCount.textContent = '0 rows';
            return;
        }

        const table = document.createElement('table');
        table.className = 'results-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        result.schema.fields.forEach(field => {
            const th = document.createElement('th');
            th.textContent = field.name;
            th.title = `${field.name} (${field.type})`;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const rows = result.toArray();
        
        rows.forEach(row => {
            const tr = document.createElement('tr');
            Object.values(row).forEach(value => {
                const td = document.createElement('td');
                td.textContent = value !== null ? value.toString() : 'NULL';
                td.className = value === null ? 'null-value' : '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        this.resultsContainer.innerHTML = '';
        this.resultsContainer.appendChild(table);
        this.resultCount.textContent = `${result.numRows} rows`;
    }

    async handleFileUpload(event) {
        if (!this.isConnected) {
            this.showError('Please connect to DuckDB first');
            return;
        }

        const files = Array.from(event.target.files);
        
        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                
                await this.db.registerFileBuffer(file.name, uint8Array);
                
                const extension = file.name.split('.').pop().toLowerCase();
                let tableName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_');
                
                let createTableSQL = '';
                switch (extension) {
                    case 'csv':
                        createTableSQL = `CREATE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${file.name}')`;
                        break;
                    case 'json':
                        createTableSQL = `CREATE TABLE ${tableName} AS SELECT * FROM read_json_auto('${file.name}')`;
                        break;
                    case 'parquet':
                        createTableSQL = `CREATE TABLE ${tableName} AS SELECT * FROM read_parquet('${file.name}')`;
                        break;
                    default:
                        throw new Error(`Unsupported file type: ${extension}`);
                }
                
                await this.conn.query(createTableSQL);
                this.showSuccess(`Table '${tableName}' created from ${file.name}`);
                
                this.sqlQuery.value = `SELECT * FROM ${tableName} LIMIT 100;`;
            } catch (error) {
                console.error('File upload failed:', error);
                this.showError(`Failed to upload ${file.name}: ${error.message}`);
            }
        }
        
        event.target.value = '';
    }

    exportResults() {
        if (!this.lastResult) {
            this.showError('No results to export');
            return;
        }

        try {
            const rows = this.lastResult.toArray();
            const headers = this.lastResult.schema.fields.map(field => field.name);
            
            let csvContent = headers.join(',') + '\n';
            rows.forEach(row => {
                const values = headers.map(header => {
                    const value = row[header];
                    if (value === null) return '';
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        return '"' + value.replace(/"/g, '""') + '"';
                    }
                    return value;
                });
                csvContent += values.join(',') + '\n';
            });

            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `duckdb_results_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            
            this.showSuccess('Results exported successfully');
        } catch (error) {
            console.error('Export failed:', error);
            this.showError(`Export failed: ${error.message}`);
        }
    }

    clearQuery() {
        this.sqlQuery.value = '';
        this.sqlQuery.focus();
    }

    updateStatus(message, type) {
        this.connectionStatus.textContent = message;
        this.connectionStatus.className = `status ${type}`;
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.remove();
        }, 5000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DuckDBUI();
});