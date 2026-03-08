import React from 'react';

export default function ActiveTabContent(props) {
  const { activeTab, ticketsContent } = props;

  const renderView = (ViewComponent, extraProps = {}) => {
    if (typeof ViewComponent !== 'function') {
      console.warn('Vista non valida ignorata:', ViewComponent);
      return null;
    }
    // Queste viste sono funzioni definite dentro AppPage:
    // renderizzarle come <ViewComponent /> le farebbe rimontare a ogni re-render
    // (perché cambia l'identità della funzione), causando perdita di focus negli input.
    return ViewComponent(extraProps);
  };

  return (
    <>
      {activeTab === 'dashboard' && renderView(props.DashboardView)}
      {activeTab === 'calendar' && renderView(props.CalendarView)}
      {activeTab === 'customers' && renderView(props.CustomerListView)}
      {activeTab === 'interventions' && renderView(props.InterventionsView)}
      {activeTab === 'inventory' && renderView(props.InventoryView)}
      {activeTab === 'settings' && renderView(props.SettingsPanel)}
      {(activeTab === 'chiamate' || activeTab === 'riparazioni' || activeTab === 'ordine-ricambi' || activeTab === 'preventivi-nuovi') && (
        renderView(props.DedicatedInterventionDashboard, { tabKey: activeTab })
      )}
      {activeTab === 'tickets' && ticketsContent}
    </>
  );
}
