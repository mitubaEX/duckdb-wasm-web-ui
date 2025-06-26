import { sql } from '@codemirror/lang-sql'
import { EditorState } from '@codemirror/state'
import { panels, showPanel } from '@codemirror/view'
import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?worker'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import { vim } from '@replit/codemirror-vim'
import { EditorView, basicSetup } from 'codemirror'

class DuckDBUI {
  private db: duckdb.AsyncDuckDB | null = null
  private conn: duckdb.AsyncDuckDBConnection | null = null
  private isConnected = false
  private editor: EditorView | null = null
  private vimEnabled = false
  private tables: string[] = []
  private selectedTable: string = ''
  private currentPage = 1
  private pageSize = 25
  private totalRows = 0
  private isPaginated = false

  constructor() {
    this.initializeElements()
    this.bindEvents()
    this.checkOPFSSupport()
  }

  private initializeElements() {
    const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
    const fileInput = document.getElementById('file-input') as HTMLInputElement
    const generateQueryBtn = document.getElementById('generate-query') as HTMLButtonElement
    const aggTableSelect = document.getElementById('agg-table-select') as HTMLSelectElement
    const aggFunctionSelect = document.getElementById('agg-function-select') as HTMLSelectElement

    // Pagination controls
    const firstPageBtn = document.getElementById('first-page') as HTMLButtonElement
    const prevPageBtn = document.getElementById('prev-page') as HTMLButtonElement
    const nextPageBtn = document.getElementById('next-page') as HTMLButtonElement
    const lastPageBtn = document.getElementById('last-page') as HTMLButtonElement
    const pageSizeSelect = document.getElementById('page-size') as HTMLSelectElement

    connectBtn?.addEventListener('click', () => this.connect())
    fileInput?.addEventListener('change', (e) => this.handleFileUpload(e))
    generateQueryBtn?.addEventListener('click', () => this.generateAggregationQuery())
    aggTableSelect?.addEventListener('change', () => this.updateColumnSelects())
    aggFunctionSelect?.addEventListener('change', () => this.toggleValueColumn())
    
    // Add event listeners for updating order by options
    const aggColumnSelect = document.getElementById('agg-column-select') as HTMLSelectElement
    const aggValueColumn = document.getElementById('agg-value-column') as HTMLSelectElement
    
    aggColumnSelect?.addEventListener('change', () => this.updateOrderByOptions())
    aggValueColumn?.addEventListener('change', () => this.updateOrderByOptions())

    // Pagination event listeners
    if (firstPageBtn) {
      firstPageBtn.addEventListener('click', () => {
        console.log('First page button clicked')
        this.goToPage(1)
      })
    }
    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        console.log('Previous page button clicked, current page:', this.currentPage)
        this.goToPage(this.currentPage - 1)
      })
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        console.log('Next page button clicked, current page:', this.currentPage)
        this.goToPage(this.currentPage + 1)
      })
    }
    if (lastPageBtn) {
      lastPageBtn.addEventListener('click', () => {
        console.log('Last page button clicked')
        this.goToPage(Math.ceil(this.totalRows / this.pageSize))
      })
    }
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', () => {
        this.pageSize = parseInt(pageSizeSelect.value)
        this.currentPage = 1
        if (this.isPaginated && this.selectedTable) {
          this.selectTable(this.selectedTable)
        }
      })
    }

    this.initializeEditor()
  }

  private bindEvents() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        this.executeCurrentQuery()
      }
      if (e.ctrlKey && e.key === 'v') {
        this.toggleVim()
      }
    })
  }

  private checkOPFSSupport() {
    const opfsStatus = document.getElementById('opfs-status')
    if (opfsStatus) {
      if ('navigator' in globalThis && 'storage' in navigator && 'getDirectory' in navigator.storage) {
        opfsStatus.textContent = 'OPFS: Supported'
        opfsStatus.className = 'status connected'
      } else {
        opfsStatus.textContent = 'OPFS: Not Supported'
        opfsStatus.className = 'status error'
      }
    }
  }

  private initializeEditor() {
    const editorElement = document.getElementById('editor')
    if (!editorElement) return

    const state = EditorState.create({
      doc: '-- Enter your SQL query here\nSELECT \'Hello, DuckDB WASM!\' as message;',
      extensions: [
        basicSetup,
        sql(),
        EditorView.theme({
          '&': { height: '200px' },
          '.cm-content': { padding: '12px' },
          '.cm-editor': { fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace' }
        })
      ]
    })

    this.editor = new EditorView({
      state,
      parent: editorElement
    })
  }

  private toggleVim() {
    if (!this.editor) return

    this.vimEnabled = !this.vimEnabled
    const extensions = [
      basicSetup,
      sql(),
      EditorView.theme({
        '&': { height: '200px' },
        '.cm-content': { padding: '12px' },
        '.cm-editor': { fontSize: '14px' },
        '.cm-scroller': { fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace' }
      })
    ]

    if (this.vimEnabled) {
      extensions.push(vim())
    }

    const state = EditorState.create({
      doc: this.editor.state.doc,
      extensions
    })

    this.editor.setState(state)
  }

  private async connect() {
    try {
      const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
      connectBtn.textContent = 'Connecting...'
      connectBtn.disabled = true

      // Use jsDelivr CDN for WASM files to avoid size limits
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

      // Select bundle based on browser capabilities
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)

      // Create worker
      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'text/javascript'})
      );
      const worker = new Worker(worker_url)
      const logger = new duckdb.ConsoleLogger()

      // Initialize database
      this.db = new duckdb.AsyncDuckDB(logger, worker)
      await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker)
      
      // Clean up worker URL
      URL.revokeObjectURL(worker_url)

      // Connect to database
      this.conn = await this.db.connect()

      this.isConnected = true
      this.updateConnectionStatus('Connected', 'connected')
      this.enableControls()

      // Show DuckDB version
      const versionResult = await this.conn.query('SELECT version() as version')
      const versionData = versionResult.toArray()
      const versionElement = document.getElementById('duckdb-version')
      if (versionElement && versionData.length > 0) {
        versionElement.textContent = `DuckDB Version: ${versionData[0].version}`
      }

      // Execute welcome query
      await this.executeQuery('SELECT \'Welcome to DuckDB WASM!\' as message')
      
      // Refresh tables list in case there are existing tables
      await this.refreshTablesList()

    } catch (error) {
      console.error('Connection failed:', error)
      this.updateConnectionStatus('Connection Failed', 'error')
      const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
      connectBtn.textContent = 'Retry Connection'
      connectBtn.disabled = false
      this.showError(`Connection failed: ${error}`)
    }
  }

  private enableControls() {
    // No additional controls to enable
  }

  private async executeQuery(sql: string, maintainPagination: boolean = false) {
    if (!this.conn) {
      this.showError('Not connected to database')
      return
    }

    try {
      // Reset pagination state for manual queries (unless explicitly maintaining pagination)
      if (!maintainPagination && (!sql.includes('LIMIT') || !sql.includes('OFFSET'))) {
        this.isPaginated = false
      }
      
      const startTime = Date.now()
      const result = await this.conn.query(sql)
      const endTime = Date.now()

      this.displayResults(result, endTime - startTime)
    } catch (error) {
      console.error('Query execution failed:', error)
      this.showError(`Query failed: ${error}`)
    }
  }

  private executeCurrentQuery() {
    if (!this.editor) return
    const query = this.editor.state.doc.toString().trim()
    if (query) {
      this.executeQuery(query)
    }
  }

  private displayResults(result: duckdb.AsyncDuckDBResult, executionTime: number) {
    const resultElement = document.getElementById('result')
    const countElement = document.getElementById('count')
    
    if (!resultElement || !countElement) return

    const numRows = result.numRows
    
    // Update count display based on pagination
    if (this.isPaginated) {
      countElement.textContent = `${numRows} rows displayed in ${executionTime}ms`
    } else {
      countElement.textContent = `${numRows} rows returned in ${executionTime}ms`
      // Hide pagination for non-paginated results
      const paginationDiv = document.getElementById('pagination')
      if (paginationDiv) paginationDiv.style.display = 'none'
    }

    if (numRows === 0) {
      resultElement.innerHTML = '<p>No results returned</p>'
      return
    }

    // Convert to array for display
    const rows = result.toArray()
    const columns = result.schema.fields

    // Create table
    const table = document.createElement('table')
    
    // Create header
    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    columns.forEach(field => {
      const th = document.createElement('th')
      th.textContent = field.name
      th.title = `${field.name} (${field.type})`
      headerRow.appendChild(th)
    })
    thead.appendChild(headerRow)
    table.appendChild(thead)

    // Create body
    const tbody = document.createElement('tbody')
    rows.forEach(row => {
      const tr = document.createElement('tr')
      columns.forEach(field => {
        const td = document.createElement('td')
        const value = row[field.name]
        td.textContent = value !== null && value !== undefined ? String(value) : 'NULL'
        if (value === null || value === undefined) {
          td.style.fontStyle = 'italic'
          td.style.color = '#64748b'
        }
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)

    resultElement.innerHTML = ''
    resultElement.appendChild(table)
  }


  private async handleFileUpload(event: Event) {
    if (!this.conn) {
      this.showError('Please connect to DuckDB first')
      return
    }

    const input = event.target as HTMLInputElement
    const files = Array.from(input.files || [])

    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        
        await this.db!.registerFileBuffer(file.name, uint8Array)
        
        const extension = file.name.split('.').pop()?.toLowerCase()
        const tableName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_')
        
        let createTableSQL = ''
        switch (extension) {
          case 'csv':
            createTableSQL = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${file.name}')`
            break
          case 'json':
            createTableSQL = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_json_auto('${file.name}')`
            break
          case 'parquet':
            createTableSQL = `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_parquet('${file.name}')`
            break
          default:
            throw new Error(`Unsupported file type: ${extension}`)
        }
        
        await this.conn.query(createTableSQL)
        this.showSuccess(`Table '${tableName}' created from ${file.name}`)
        
        // Show preview
        await this.executeQuery(`SELECT * FROM ${tableName} LIMIT 10`)
        
        // Update tables list
        await this.refreshTablesList()
        
      } catch (error) {
        console.error('File upload failed:', error)
        this.showError(`Failed to upload ${file.name}: ${error}`)
      }
    }
    
    input.value = ''
  }

  private async refreshTablesList() {
    if (!this.conn) return

    try {
      const tablesResult = await this.conn.query('SHOW TABLES')
      const tablesData = tablesResult.toArray()
      this.tables = tablesData.map((row: any) => row.name)
      
      this.displayTables()
      this.updateAggregationSelects()
    } catch (error) {
      console.error('Failed to refresh tables:', error)
    }
  }

  private displayTables() {
    const tablesSection = document.getElementById('tables-section')
    const tablesList = document.getElementById('tables-list')
    
    if (!tablesSection || !tablesList) return

    if (this.tables.length === 0) {
      tablesSection.style.display = 'none'
      return
    }

    tablesSection.style.display = 'block'
    tablesList.innerHTML = ''

    this.tables.forEach(tableName => {
      const tableCard = document.createElement('div')
      tableCard.className = 'table-card'
      tableCard.addEventListener('click', () => this.selectTable(tableName))
      
      const nameDiv = document.createElement('div')
      nameDiv.className = 'table-name'
      nameDiv.textContent = tableName
      
      const infoDiv = document.createElement('div')
      infoDiv.className = 'table-info'
      infoDiv.textContent = 'Click to preview'
      
      tableCard.appendChild(nameDiv)
      tableCard.appendChild(infoDiv)
      tablesList.appendChild(tableCard)
    })
  }

  private async selectTable(tableName: string) {
    this.selectedTable = tableName
    this.currentPage = 1
    this.isPaginated = true
    
    // Update visual selection
    const tableCards = document.querySelectorAll('.table-card')
    tableCards.forEach(card => card.classList.remove('selected'))
    
    const selectedCard = Array.from(tableCards).find(card => 
      card.querySelector('.table-name')?.textContent === tableName
    )
    selectedCard?.classList.add('selected')
    
    // Get total row count
    await this.updateTotalRows(tableName)
    
    // Show paginated preview
    await this.loadPage()
  }

  private async updateTotalRows(tableName: string) {
    if (!this.conn) return
    
    try {
      const countResult = await this.conn.query(`SELECT COUNT(*) as total FROM ${tableName}`)
      const countData = countResult.toArray()
      this.totalRows = countData[0].total
    } catch (error) {
      console.error('Failed to get total rows:', error)
      this.totalRows = 0
    }
  }

  private async loadPage() {
    if (!this.conn || !this.selectedTable) {
      console.log('loadPage: missing conn or selectedTable')
      return
    }
    
    const offset = (this.currentPage - 1) * this.pageSize
    const query = `SELECT * FROM ${this.selectedTable} LIMIT ${this.pageSize} OFFSET ${offset}`
    
    console.log(`loadPage: currentPage=${this.currentPage}, pageSize=${this.pageSize}, offset=${offset}`)
    console.log(`Executing query: ${query}`)
    
    await this.executeQuery(query, true)  // maintainPagination = true
    this.updatePaginationControls()
  }

  private updatePaginationControls() {
    const paginationDiv = document.getElementById('pagination')
    const paginationInfo = document.getElementById('pagination-info')
    const pageInfo = document.getElementById('page-info')
    const firstPageBtn = document.getElementById('first-page') as HTMLButtonElement
    const prevPageBtn = document.getElementById('prev-page') as HTMLButtonElement
    const nextPageBtn = document.getElementById('next-page') as HTMLButtonElement
    const lastPageBtn = document.getElementById('last-page') as HTMLButtonElement
    
    console.log(`updatePaginationControls: isPaginated=${this.isPaginated}, totalRows=${this.totalRows}, currentPage=${this.currentPage}`)
    
    if (!paginationDiv || !this.isPaginated) {
      if (paginationDiv) paginationDiv.style.display = 'none'
      console.log('Hiding pagination div')
      return
    }
    
    paginationDiv.style.display = 'flex'
    
    const totalPages = Math.ceil(this.totalRows / this.pageSize)
    const startRow = (this.currentPage - 1) * this.pageSize + 1
    const endRow = Math.min(this.currentPage * this.pageSize, this.totalRows)
    
    console.log(`Pagination: totalPages=${totalPages}, startRow=${startRow}, endRow=${endRow}`)
    
    if (paginationInfo) {
      paginationInfo.textContent = `Showing ${startRow}-${endRow} of ${this.totalRows} rows`
    }
    
    if (pageInfo) {
      pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`
    }
    
    const firstDisabled = this.currentPage === 1
    const lastDisabled = this.currentPage === totalPages
    
    if (firstPageBtn) firstPageBtn.disabled = firstDisabled
    if (prevPageBtn) prevPageBtn.disabled = firstDisabled
    if (nextPageBtn) nextPageBtn.disabled = lastDisabled
    if (lastPageBtn) lastPageBtn.disabled = lastDisabled
    
    console.log(`Button states: first/prev disabled=${firstDisabled}, next/last disabled=${lastDisabled}`)
  }

  private async goToPage(page: number) {
    const totalPages = Math.ceil(this.totalRows / this.pageSize)
    
    console.log(`goToPage called: page=${page}, totalPages=${totalPages}, currentPage=${this.currentPage}, totalRows=${this.totalRows}`)
    
    if (page < 1 || page > totalPages) {
      console.log(`Page ${page} is out of range (1-${totalPages})`)
      return
    }
    
    this.currentPage = page
    console.log(`Setting currentPage to ${page}`)
    await this.loadPage()
  }

  private updateAggregationSelects() {
    const aggHelper = document.getElementById('aggregation-helper')
    const aggTableSelect = document.getElementById('agg-table-select') as HTMLSelectElement
    
    if (!aggHelper || !aggTableSelect) return

    if (this.tables.length === 0) {
      aggHelper.style.display = 'none'
      return
    }

    aggHelper.style.display = 'block'
    
    // Update table select
    aggTableSelect.innerHTML = '<option value="">Select table...</option>'
    this.tables.forEach(tableName => {
      const option = document.createElement('option')
      option.value = tableName
      option.textContent = tableName
      aggTableSelect.appendChild(option)
    })
  }

  private async updateColumnSelects() {
    const aggTableSelect = document.getElementById('agg-table-select') as HTMLSelectElement
    const aggColumnSelect = document.getElementById('agg-column-select') as HTMLSelectElement
    const aggValueColumn = document.getElementById('agg-value-column') as HTMLSelectElement
    
    if (!aggTableSelect.value || !this.conn) return

    try {
      const columnsResult = await this.conn.query(`DESCRIBE ${aggTableSelect.value}`)
      const columnsData = columnsResult.toArray()
      const columns = columnsData.map((row: any) => row.column_name)
      
      // Update group by column select
      aggColumnSelect.innerHTML = '<option value="">Select column...</option>'
      columns.forEach(columnName => {
        const option = document.createElement('option')
        option.value = columnName
        option.textContent = columnName
        aggColumnSelect.appendChild(option)
      })
      
      // Update value column select
      aggValueColumn.innerHTML = '<option value="">Select column...</option>'
      columns.forEach(columnName => {
        const option = document.createElement('option')
        option.value = columnName
        option.textContent = columnName
        aggValueColumn.appendChild(option)
      })
      
      // Update order by column select
      this.updateOrderBySelect(columns)
      
    } catch (error) {
      console.error('Failed to get columns:', error)
    }
  }

  private toggleValueColumn() {
    const aggFunctionSelect = document.getElementById('agg-function-select') as HTMLSelectElement
    const aggValueColumn = document.getElementById('agg-value-column') as HTMLSelectElement
    
    if (aggFunctionSelect.value === 'COUNT(*)') {
      aggValueColumn.style.display = 'none'
    } else {
      aggValueColumn.style.display = 'inline-block'
    }
    
    // Update order by options when aggregation function changes
    this.updateOrderByOptions()
  }

  private updateOrderBySelect(columns: string[]) {
    const aggOrderColumn = document.getElementById('agg-order-column') as HTMLSelectElement
    if (!aggOrderColumn) return

    aggOrderColumn.innerHTML = '<option value="">No ordering</option>'
    
    // Add original columns
    columns.forEach(columnName => {
      const option = document.createElement('option')
      option.value = columnName
      option.textContent = `${columnName} (original)`
      aggOrderColumn.appendChild(option)
    })
    
    this.updateOrderByOptions()
  }

  private updateOrderByOptions() {
    const aggOrderColumn = document.getElementById('agg-order-column') as HTMLSelectElement
    const aggFunctionSelect = document.getElementById('agg-function-select') as HTMLSelectElement
    const aggValueColumn = document.getElementById('agg-value-column') as HTMLSelectElement
    const aggColumnSelect = document.getElementById('agg-column-select') as HTMLSelectElement
    
    if (!aggOrderColumn || !aggFunctionSelect) return

    // Remove any existing aggregated options
    const existingOptions = Array.from(aggOrderColumn.options)
    existingOptions.forEach(option => {
      if (option.value.includes('_aggregated')) {
        option.remove()
      }
    })

    // Add aggregated column option based on current selection
    const aggFunction = aggFunctionSelect.value
    const valueColumn = aggValueColumn.value
    const groupByColumn = aggColumnSelect.value

    if (aggFunction && groupByColumn) {
      let aggregatedColumnName = ''
      let displayName = ''
      
      if (aggFunction === 'COUNT(*)') {
        aggregatedColumnName = 'count_aggregated'
        displayName = 'Count (aggregated)'
      } else if (valueColumn) {
        aggregatedColumnName = `${aggFunction.toLowerCase()}_${valueColumn}_aggregated`
        displayName = `${aggFunction}(${valueColumn}) (aggregated)`
      }
      
      if (aggregatedColumnName) {
        const option = document.createElement('option')
        option.value = aggregatedColumnName
        option.textContent = displayName
        aggOrderColumn.appendChild(option)
      }
    }
  }

  private generateAggregationQuery() {
    const aggTableSelect = document.getElementById('agg-table-select') as HTMLSelectElement
    const aggColumnSelect = document.getElementById('agg-column-select') as HTMLSelectElement
    const aggFunctionSelect = document.getElementById('agg-function-select') as HTMLSelectElement
    const aggValueColumn = document.getElementById('agg-value-column') as HTMLSelectElement
    const aggOrderColumn = document.getElementById('agg-order-column') as HTMLSelectElement
    const aggOrderDirection = document.getElementById('agg-order-direction') as HTMLSelectElement
    
    const tableName = aggTableSelect.value
    const groupByColumn = aggColumnSelect.value
    const aggFunction = aggFunctionSelect.value
    const valueColumn = aggValueColumn.value
    const orderColumn = aggOrderColumn.value
    const orderDirection = aggOrderDirection.value
    
    if (!tableName || !groupByColumn) {
      this.showError('Please select table and group by column')
      return
    }
    
    let selectClause = ''
    let aggregatedColumnAlias = ''
    
    if (aggFunction === 'COUNT(*)') {
      selectClause = `${groupByColumn}, COUNT(*) as count`
      aggregatedColumnAlias = 'count'
    } else {
      if (!valueColumn) {
        this.showError('Please select a column for the aggregation function')
        return
      }
      aggregatedColumnAlias = `${aggFunction.toLowerCase()}_${valueColumn}`
      selectClause = `${groupByColumn}, ${aggFunction}(${valueColumn}) as ${aggregatedColumnAlias}`
    }
    
    let query = `SELECT ${selectClause}
FROM ${tableName}
GROUP BY ${groupByColumn}`
    
    if (orderColumn) {
      let actualOrderColumn = orderColumn
      
      // If ordering by aggregated column, use the alias
      if (orderColumn.includes('_aggregated')) {
        actualOrderColumn = aggregatedColumnAlias
      }
      
      query += `
ORDER BY ${actualOrderColumn} ${orderDirection}`
    }
    
    query += ';'
    
    // Update editor with generated query
    if (this.editor) {
      const state = EditorState.create({
        doc: query,
        extensions: this.editor.state.extensions
      })
      this.editor.setState(state)
    }
    
    this.showSuccess('Aggregation query generated! Press Ctrl+Enter to execute.')
  }


  private updateConnectionStatus(message: string, type: string) {
    const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
    connectBtn.textContent = message
    connectBtn.className = `status ${type}`
  }

  private showError(message: string) {
    this.showMessage(message, 'error')
  }

  private showSuccess(message: string) {
    this.showMessage(message, 'success')
  }

  private showMessage(message: string, type: string) {
    const messageDiv = document.createElement('div')
    messageDiv.className = `message ${type}`
    messageDiv.textContent = message
    messageDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 500;
      z-index: 1000;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      ${type === 'success' ? 'background-color: #dcfce7; color: #166534; border: 1px solid #bbf7d0;' : 'background-color: #fee2e2; color: #991b1b; border: 1px solid #fecaca;'}
      animation: slideIn 0.3s ease-out;
    `
    
    document.body.appendChild(messageDiv)
    
    setTimeout(() => {
      messageDiv.remove()
    }, 5000)
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  new DuckDBUI()
})