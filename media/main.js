(function() {
  const vscode = acquireVsCodeApi();
  let status = 'Complete';

  const $startButton = document.getElementById('start');
  $startButton.addEventListener('click', () => status !== 'Complete' ? handleStopQuery() : handleStartQuery());

  const $groupsList = document.getElementById('groups-list');
  $groupsList.addEventListener('click', () => vscode.postMessage({ type: 'select' }));

  const $spanSelector = document.querySelectorAll('.spans .span-selector')[0];
  $spanSelector.addEventListener('click', (event) => handleSelectSpan(event.target.id === 'selector-span-relative'));

  const $relativeType = document.getElementById('query-relative-type');
  $relativeType.addEventListener('input', (event) => updateQuery('relativeType', event.target.value));

  const $relativeValue = document.getElementById('query-relative-value');
  $relativeValue.addEventListener('input', (event) => updateQuery('relativeValue', event.target.value));

  const $absoluteStartValue = document.getElementById('absolute-start-value');
  $absoluteStartValue.addEventListener('change', (event) => updateQuery('startTime', Date.parse(event.target.value) / 1000));

  const $absoluteEndValue = document.getElementById('absolute-end-value');
  $absoluteEndValue.addEventListener('change', (event) => updateQuery('endTime', Date.parse(event.target.value) / 1000));

  const $filterValue = document.getElementById('query-filter');
  $filterValue.addEventListener('input', (event) => updateQuery('queryString', event.target.value));

  const $recordsTable = document.getElementsByClassName('records-table')[0];
  $recordsTable.addEventListener('click', (event) => {
    // Request open current record in separate window
    if (event.target.classList.contains('detail-request')) {
      const $tr = getParentNode(event.target.parentNode.parentNode, 'TR');

      console.log($tr.dataset);
      return vscode.postMessage({ type: 'open_request', payload: { id: event.target.innerHTML, timestamp: $tr.dataset.timestamp }});
    }

    // Open/Close record
    const $row = getParentNode(event.target, 'TR');
    if ($row.classList.contains('row')) {
      const $next = $row.nextSibling;
      $next.classList.toggle('hide-row');

      if (!$next.dataset.id && !$next.classList.contains('hide-row')) {
        vscode.postMessage({ type: 'expand', payload: { id: $row.id }});
      }
    }
  });

  window.addEventListener('message', ({ data }) => {
    console.log('Get message from extention:', data.type);

    const handlers = { query: handleUpdateQuery, expand_result: handleUpdateDetail, result: handleUpdateRecords };
    handlers[data.type] && handlers[data.type].call(this, data);
  });

  const state = vscode.getState();
	if (state) {
    state.query && handleUpdateQuery({ payload: state.query });
	}

  /**
   * Start query
   */
  function handleStartQuery() {
    status = 'Running';
    vscode.postMessage({ type: 'execute' });

    $recordsTable.replaceChildren();
    $startButton.innerHTML = '&#x25A0;';
  }

  /**
   * Stop query
   */
  function handleStopQuery() {
    status = 'Complete';
    vscode.postMessage({ type: 'stop' });
    $startButton.innerHTML = '&#x25B6;';
  }

  /**
   * Receive new query from extenstion and update ui
   */
  function handleUpdateQuery({ payload: query }) {
    setState({ query });

    // Log groups
    const logGroupNames = query.logGroupName ? [query.logGroupName] : query.logGroupNames;
    $groupsList.innerHTML = logGroupNames.join(', ');

    // Time spans
    query.relativeTime ? initializeRelativeSpan(query.relativeTime) : initializeAbsoluteSpan(query.startTime, query.endTime);

    // Filter
    $filterValue.value = query.queryString ?? '';
  }

  function handleSelectSpan(relative) {
    const { query } =  vscode.getState();
    if (query.relativeTime === relative) { return }

    query.relativeTime = query.startTime = query.endTime = undefined;
    Object.assign(query, relative ? initializeRelativeSpan() : initializeAbsoluteSpan());

    setState({ query });
    vscode.postMessage({ type: 'query', payload: query });
  }

  function switchTimeSpan(active, inactive) {
    document.getElementById(`selector-${active}`).classList.add('span-active');
    document.getElementById(`selector-${inactive}`).classList.remove('span-active');

    document.getElementById(active).classList.remove('hide');
    document.getElementById(inactive).classList.add('hide');
  }

  function initializeRelativeSpan(initial) {
    const [ relativeTime, _, value ] = (initial || '').match(/^(P|PT)(\d+)([MHDWY])$/) || [ 'PT15M', 'PT', 15 ];

    $relativeValue.value = +value;
    $relativeType.value = relativeTime.replace(value, 'n');

    switchTimeSpan('span-relative', 'span-absolute');
    return { relativeTime };
  }

  function initializeAbsoluteSpan(startTime, endTime) {
    endTime = endTime || Math.floor((new Date()).getTime() / 1000);
    startTime = startTime || (endTime - 15 * 60);

    $absoluteStartValue.value = getDateString(startTime * 1000);
    $absoluteEndValue.value = getDateString(endTime * 1000);

    switchTimeSpan('span-absolute', 'span-relative');
    return { startTime, endTime };
  }

  /**
   * Render records
   */
  function handleUpdateRecords({ payload }) {
    const $recordsTable = document.getElementsByClassName('records-table')[0]
    const $fragment = document.createDocumentFragment();

    status = payload.status;
    if (status !== 'Running') {
      $startButton.innerHTML = '&#x25B6;';
    }

    const { results } = payload;
    if (!results.length) { return }

    createElement($fragment, 'thead', (node) => {
      createElement(node, 'tr', (node) => {
        results[0].fields.forEach(({ field }) => createElement(node, 'th', { innerHTML: field }));
      });
    });

    createElement($fragment, 'tbody', (node) => {
      results.forEach((record, index) => {
        createElement(node, 'tr', { id: record.id, className: `row ${!(index % 2) && 'even'}` }, (node) => {
          record.fields.forEach(({ value }) => createElement(node, 'td', { innerHTML: value }));
        });
        createElement(node, 'tr', { id: `detail-${record.id}`, className: `row-detail ${!(index % 2) && 'even'} hide-row` }, (node) => {
          createElement(node, 'td', { colSpan: record.fields.length, innerHTML: 'Loading…' });
        });
      });
    });
    
    $recordsTable.replaceChildren($fragment);
  }

  /**
   * Render record's detail
   */  
  function handleUpdateDetail({ payload }) {
    const $fragment = document.createDocumentFragment();

    createElement($fragment, 'table', { className: 'detail-table' }, (node) => {
      createElement(node, 'tbody', (node) => {
        Object.keys(payload.record).forEach((key) => {
          createElement(node, 'tr', (node) => {
            createElement(node, 'td', { innerHTML: key });
            createElement(node, 'td', (node) => {
              if (key === '@requestId') {
                createElement(node, 'a', { href: '#', innerHTML: payload.record[key], className: 'detail-request' });
              }
              else {
                node.innerHTML = payload.record[key];
              }
            });
          });
        })
      });
    });
    
    const $tr = document.getElementById(`detail-${payload.id}`);
    $tr.firstChild.replaceChildren($fragment);

    $tr.dataset.id = payload.id;
    $tr.dataset.timestamp = payload.record['@timestamp'];
  }

  /**
   * Create element helper
   */
  function createElement(parent, tagName, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const $node = document.createElement(tagName);
    Object.keys(options).forEach((key) => { $node[key] = options[key] });

    callback && callback($node);
    parent && parent.appendChild($node);
    return $node;
  }

  /**
   * Find parent element helper
   */  
  function getParentNode(target, tagName) {
    let current = target.parentNode;
    while (current && current.tagName !== tagName) {
      current = current.parentNode;
      console.log(current.tagName);
    }
    return current;
  }

  function handleUpdaeAbsoluteValue(selector, value) {
    console.log(selector, value, Date.parse(value) / 1000);

    
  }

  function updateQuery(key, value) {
    if (key === 'relativeType' || key === 'relativeValue') {
      key = 'relativeTime';
      value = $relativeType.value.replace('n', $relativeValue.value);
    }

    const payload = { ...vscode.getState().query, ...{ [key]: value }};
    setState({ query: payload });
    vscode.postMessage({ type: 'query', payload });
  }

  function setState(state) {
    vscode.setState({ ...vscode.getState(), ...state });
  }

  /**
   * Convert Date to format for input[type=datetime-local]
   */
  function getDateString(date) {
    const newDate = date ? new Date(date) : new Date();
    return new Date(newDate.getTime() - newDate.getTimezoneOffset() * 60000).toISOString().slice(0, -1); 
  }

}());