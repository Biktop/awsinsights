(function() {
  console.log('Init client');

  const vscode = acquireVsCodeApi();

  const $groups_list = document.getElementById('groups-list');
  $groups_list.addEventListener('click', () => vscode.postMessage({ type: 'select' }));


  const btn = document.getElementById('btn-execute');
  btn.addEventListener('click', () => {
    

    vscode.postMessage({ type: 'execute' });



  });

  const $spanSelector = document.querySelectorAll('.spans .span-selector')[0];
  $spanSelector.addEventListener('click', (event) => {
    if (event.target.classList.contains('span-active')) { return }
    event.target.getAttribute('for') === 'span-relative' ? selectRelativeSpan() : selectAbsoluteSpan();
  });


  const $relativetype = document.getElementById('query-relative-type');
  $relativetype.addEventListener('input', (event) => updateQuery('relativeType', event.target.value));

  const $relativevalue = document.getElementById('query-relative-value');
  $relativevalue.addEventListener('input', (event) => updateQuery('relativeValue', event.target.value));

  const $textarea = document.getElementById('query-filter');
  $textarea.addEventListener('input', (event) => updateQuery('queryString', event.target.value));

  const $table = document.getElementsByClassName('records-table')[0];
  $table.addEventListener('click', (event) => {
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

  function handleUpdateQuery({ payload: query }) {
    setState({ query });

    const container = document.getElementById('content');
    container.innerHTML = JSON.stringify(query);

    if (query.relativeTime) {

      const mc = query.relativeTime.match(/^(P|PT)(\d+)([MHDWY])$/);
      console.log(mc);

      $relativevalue.value = +mc[2];

      const res = query.relativeTime.replace(mc[2], 'n');

      console.log(res);

      $relativetype.value = res;




    }

    // Log groups
    const logGroupNames = query.logGroupName ? [query.logGroupName] : query.logGroupNames;
    $groups_list.innerHTML = logGroupNames.join(', ');

    // Time spans
    // $spanSelector

    query.relativeTime ? selectRelativeSpan() : selectAbsoluteSpan();


    

    $textarea.value = query.queryString ?? '';
  }

  function selectRelativeSpan() {

    console.log('selectRelativeSpan');

    $spanSelector.firstChild.classList.add('span-active');
    $spanSelector.lastChild.classList.remove('span-active');

    const $spanRelative = document.getElementById('span-relative');
    const $spanAbsolute = document.getElementById('span-absolute');

    $spanRelative.classList.remove('hide');
    $spanAbsolute.classList.add('hide');









    // $spanSelector.firstChild.classList.toggle('span-active');
    // $spanSelector.lastChild.classList.toggle('span-active');


    // console.log('AAAA', event.target.getAttribute('for'));



  }

  function selectAbsoluteSpan() {

    console.log('selectAbsoluteSpan');

    $spanSelector.firstChild.classList.remove('span-active');
    $spanSelector.lastChild.classList.add('span-active');

    const $spanRelative = document.getElementById('span-relative');
    const $spanAbsolute = document.getElementById('span-absolute');

    $spanRelative.classList.add('hide');
    $spanAbsolute.classList.remove('hide');



  }

  /**
   * Render records
   */
  function handleUpdateRecords({ payload }) {
    const $table = document.getElementsByClassName('records-table')[0]
    const $fragment = document.createDocumentFragment();

    $table.replaceChildren();

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
    
    $table.replaceChildren($fragment);
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

  function updateQuery(key, value) {
    if (key === 'relativeType' || key === 'relativeValue') {
      key = 'relativeTime';
      value = $relativetype.value.replace('n', $relativevalue.value);
    }

    const payload = { ...vscode.getState().query, ...{ [key]: value }};
    setState({ query: payload });
    vscode.postMessage({ type: 'query', payload });
  }

  function setState(state) {
    vscode.setState({ ...vscode.getState(), ...state });
  }

}());