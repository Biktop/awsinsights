(function() {
  const vscode = acquireVsCodeApi();

  const btn = document.getElementById('btn-execute');
  btn.addEventListener('click', () => {

    vscode.postMessage({ type: 'execute' });



  });

  const $textarea = document.getElementsByClassName('panel')[0].getElementsByTagName('TEXTAREA')[0];
  $textarea.addEventListener('input', (event) => updateQuery('queryString', event.target.value));

  const $table = document.getElementsByClassName('records-table')[0];
  $table.addEventListener('click', (event) => {
    if (event.target.classList.contains('detail-request')) {
      return vscode.postMessage({ type: 'open_request', payload: { id: event.target.innerHTML }});
    }

    const $row = getParentNode(event.target, 'TR');
    if ($row.classList.contains('row')) {
      const $next = $row.nextSibling;
      $next.classList.toggle('hide-row');

      if (!$next.classList.contains('hide-row')) {
        vscode.postMessage({ type: 'expand', payload: { id: $row.id }});
      }
    }
  });

  window.addEventListener('message', ({ data }) => {
    console.log('Get message from extention:', data.type);

    const handlers = { query: handleUpdateQuery, expand_result: handleUpdateDetail, result: handleUpdateRecords };
    handlers[data.type] && handlers[data.type].call(this, data);
    
    // vscode.setState(data);
  });

  const state = vscode.getState();

	// if (state) {
	// 	updateContent(state);
	// }

  function handleUpdateQuery({ payload }) {
    setState({ query: payload });

    const container = document.getElementById('content');
    container.innerHTML = JSON.stringify(payload);

    $textarea.value = payload.queryString ?? '';
  }

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
    
    const $tr = document.getElementById(`detail-${payload.id}`).firstChild;
    $tr.replaceChildren($fragment);    
  }

  function handleUpdateRecords({ payload }) {
    const { results } = payload;
    const $fragment = document.createDocumentFragment();

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
    
    const $table = document.getElementsByClassName('records-table')[0]
    $table.replaceChildren($fragment);
  }

  function createElement(parent, tagName, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const $node = document.createElement(tagName);
    Object.keys(options).forEach((key) => { $node[key] = options[key] });

    callback && callback($node);
    parent.appendChild($node);
    return $node;
  }

  function getParentNode(target, tagName) {
    let current = target.parentNode;
    while (current && current.tagName !== tagName) {
      current = current.parentNode;
      console.log(current.tagName);
    }
    return current;
  }

  function updateQuery(key, value) {
    const payload = { ...vscode.getState().query, ...{ [key]: value }};
    setState({ query: payload });
    vscode.postMessage({ type: 'query', payload });
  }

  function setState(state) {
    vscode.setState({ ...vscode.getState(), ...state });
  }

}());