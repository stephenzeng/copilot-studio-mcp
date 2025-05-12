using MCP.HTTP.Server.Services;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol.Messages;
using ModelContextProtocol.Protocol.Transport;
using ModelContextProtocol.Server;
using ModelContextProtocol.Utils.Json;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Debug()
    .WriteTo.Console(standardErrorFromLevel: Serilog.Events.LogEventLevel.Information)
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddSerilog();

var connectionString = builder.Configuration.GetValue<string>("ConnectionStrings:tableServiceConnectionName");

builder.Services
    .AddSingleton<IEmployeeVacationService>(sp =>
    {
        var connectionString = builder.Configuration.GetValue<string>("ConnectionStrings:tableServiceConnectionName");
        var tableName = "VacationsTable";
        return new EmployeeVacationService(connectionString, tableName, sp.GetRequiredService<ILogger<EmployeeVacationService>>());
    })
    .AddMcpServer()
    .WithHttpTransport()
    .WithTools<EmployeeVacationTool>();

var app = builder.Build();

// Seed fake employees if table is empty
using (var scope = app.Services.CreateScope())
{
    var vacationService = scope.ServiceProvider.GetRequiredService<IEmployeeVacationService>() as EmployeeVacationService;
    if (vacationService != null && await vacationService.IsTableEmptyAsync())
    {
        await vacationService.SeedFakeEmployeesAsync();
    }
}

app.MapMcp();

app.Run();
