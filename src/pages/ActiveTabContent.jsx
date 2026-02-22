import React from 'react';

export default function ActiveTabContent(props) {
  const { activeTab, ticketsContent } = props;

  return (
    <>
      {activeTab === 'dashboard' && <props.DashboardView />}
      {activeTab === 'calendar' && <props.CalendarView />}
      {activeTab === 'customers' && <props.CustomerListView />}
      {activeTab === 'interventions' && <props.InterventionsView />}
      {activeTab === 'inventory' && <props.InventoryView />}
      {activeTab === 'settings' && <props.SettingsPanel />}
      {(activeTab === 'chiamate' || activeTab === 'riparazioni' || activeTab === 'ordine-ricambi' || activeTab === 'preventivi-nuovi') && (
        <props.DedicatedInterventionDashboard tabKey={activeTab} />
      )}
      {activeTab === 'tickets' && ticketsContent}
    </>
  );
}
